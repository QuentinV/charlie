/*
 * PAJ7620U2 air-gesture sensor on the display's I2C bus.
 *
 * The Waveshare JD9365 driver installs the legacy I2C driver on I2C_NUM_1
 * (SDA=GPIO7, SCL=GPIO8, 100 kHz) and never releases it, and the touch
 * controller already talks to that port. This driver therefore only issues
 * transfers on the existing port — a second i2c_driver_install() on the same
 * port would fail. echo_sensors_init() must run after echo_display_init().
 *
 * The sensor answers on 0x73. Gesture flags live in bank 0, registers 0x43
 * (up/down/left/right/forward/backward/clockwise/counter-clockwise) and 0x44
 * (wave); each flag is cleared by writing the register back with zeros.
 *
 * Register table below: the gesture-configuration block of the PixArt
 * recommended sequence (0x37..0x6E). The vendor table continues with ~40
 * writes of 0x00 to unused bank-0 registers, which this driver omits because
 * those registers already reset to 0x00. If a particular module ships a sensor
 * that ignores gestures, the full vendor table is the first thing to try.
 *
 * The INT output (active low, optional) is used as a gate rather than an
 * interrupt source: the task only performs the register read when the line is
 * asserted, which keeps the shared bus free of pointless traffic.
 */
#include "echo_sensors_internal.h"

#include "driver/gpio.h"
#include "driver/i2c.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

#ifdef CONFIG_ECHO_SENSORS_PAJ7620_ENABLED

#include "echo_events.h"

static const char *TAG = "echo_gesture";

#define PAJ_ADDR        ((uint16_t)CONFIG_ECHO_SENSORS_PAJ7620_I2C_ADDR)
#define PAJ_PORT        ((i2c_port_t)CONFIG_ECHO_SENSORS_I2C_PORT)
#define PAJ_TIMEOUT     pdMS_TO_TICKS(50)
#define PAJ_POLL_MS     CONFIG_ECHO_SENSORS_PAJ7620_POLL_MS
#define PAJ_TASK_STACK  3072
#define PAJ_TASK_PRIO   3

/* Bank-0 registers. */
#define PAJ_REG_BANK_SEL    0xEF
#define PAJ_REG_PART_ID0    0x00
#define PAJ_REG_PART_ID1    0x01
#define PAJ_REG_FLAGS_A     0x43
#define PAJ_REG_FLAGS_B     0x44

#define PAJ_PART_ID0_VAL    0x20
#define PAJ_PART_ID1_VAL    0x76

/* Flags in 0x43. */
#define PAJ_F_UP            0x01
#define PAJ_F_DOWN          0x02
#define PAJ_F_LEFT          0x04
#define PAJ_F_RIGHT         0x08
#define PAJ_F_FORWARD       0x10
#define PAJ_F_BACKWARD      0x20
#define PAJ_F_CLOCKWISE     0x40
#define PAJ_F_COUNTERCW     0x80
/* Flag in 0x44. */
#define PAJ_F_WAVE          0x01

/* Gesture-configuration block of the PixArt recommended sequence, bank 0. */
static const uint8_t k_init_regs[][2] = {
    {0xEF, 0x00},
    {0x37, 0x07}, {0x38, 0x17}, {0x39, 0x06}, {0x3A, 0x12},
    {0x3F, 0x00}, {0x40, 0x02}, {0x41, 0xFF}, {0x42, 0x01},
    {0x43, 0x00}, {0x44, 0x00}, {0x45, 0x02}, {0x46, 0x2D},
    {0x47, 0x0F}, {0x48, 0x3C}, {0x49, 0x00}, {0x4A, 0x1E},
    {0x4B, 0x00}, {0x4C, 0x00}, {0x4D, 0x00}, {0x51, 0x13},
    {0x5E, 0x10}, {0x5F, 0x00}, {0x60, 0x27}, {0x61, 0x28},
    {0x62, 0x00}, {0x63, 0x03}, {0x64, 0x01}, {0x65, 0x0F},
    {0x66, 0x10}, {0x67, 0x00}, {0x68, 0x00}, {0x69, 0x02},
    {0x6A, 0x25}, {0x6B, 0x01}, {0x6C, 0x00}, {0x6D, 0x00},
    {0x6E, 0x00},
};

static TaskHandle_t s_task;
static volatile bool s_ready;

static esp_err_t paj_write_u8(uint8_t reg, uint8_t value)
{
    const uint8_t payload[2] = {reg, value};
    return i2c_master_write_to_device(PAJ_PORT, PAJ_ADDR, payload, sizeof(payload),
                                      PAJ_TIMEOUT);
}

static esp_err_t paj_read(uint8_t reg, uint8_t *buf, size_t len)
{
    return i2c_master_write_read_device(PAJ_PORT, PAJ_ADDR, &reg, 1, buf, len,
                                        PAJ_TIMEOUT);
}

static void publish(echo_gesture_kind_t kind, uint8_t flags_a, uint8_t flags_b)
{
    const echo_air_gesture_t evt = {
        .kind = kind,
        .timestamp_us = esp_timer_get_time(),
        .raw_flags = {flags_a, flags_b},
    };
    const esp_err_t err = echo_event_bus_post(ECHO_EVT_AIR_GESTURE, &evt, sizeof(evt));
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "event post failed: %s", esp_err_to_name(err));
    }
}

/* Publish one event per asserted flag. The sensor almost always reports a
 * single flag per gesture, but the loop keeps the rare double match intact. */
static void handle_flags(uint8_t flags_a, uint8_t flags_b)
{
    static const struct {
        uint8_t             mask;
        echo_gesture_kind_t kind;
    } k_map_a[] = {
        {PAJ_F_UP,        ECHO_GESTURE_SWIPE_UP},
        {PAJ_F_DOWN,      ECHO_GESTURE_SWIPE_DOWN},
        {PAJ_F_LEFT,      ECHO_GESTURE_SWIPE_LEFT},
        {PAJ_F_RIGHT,     ECHO_GESTURE_SWIPE_RIGHT},
        {PAJ_F_FORWARD,   ECHO_GESTURE_FORWARD},
        {PAJ_F_BACKWARD,  ECHO_GESTURE_BACKWARD},
        {PAJ_F_CLOCKWISE, ECHO_GESTURE_CLOCKWISE},
        {PAJ_F_COUNTERCW, ECHO_GESTURE_COUNTERCLOCKWISE},
    };

    ESP_LOGI(TAG, "gesture flags 0x%02X/0x%02X", flags_a, flags_b);
    for (size_t i = 0; i < sizeof(k_map_a) / sizeof(k_map_a[0]); i++) {
        if ((flags_a & k_map_a[i].mask) != 0) {
            publish(k_map_a[i].kind, flags_a, flags_b);
        }
    }
    if ((flags_b & PAJ_F_WAVE) != 0) {
        publish(ECHO_GESTURE_WAVE, flags_a, flags_b);
    }
}

/* Read and clear the gesture registers. Returns true when a gesture was posted. */
static bool poll_once(void)
{
    uint8_t flags[2] = {0};
    const esp_err_t err = paj_read(PAJ_REG_FLAGS_A, flags, sizeof(flags));
    if (err != ESP_OK) {
        ESP_LOGD(TAG, "flag read failed: %s", esp_err_to_name(err));
        return false;
    }
    if ((flags[0] | flags[1]) == 0) {
        return false;
    }

    /* Clear before publishing: a failed post must not replay the gesture. */
    (void)paj_write_u8(PAJ_REG_FLAGS_A, 0x00);
    (void)paj_write_u8(PAJ_REG_FLAGS_B, 0x00);

    handle_flags(flags[0], flags[1]);
    return true;
}

static void paj7620_task(void *arg)
{
    (void)arg;
    ESP_LOGI(TAG, "polling every %d ms (INT %s)", PAJ_POLL_MS,
             CONFIG_ECHO_SENSORS_PAJ7620_INT_GPIO >= 0 ? "gated" : "ignored");

    while (true) {
#if CONFIG_ECHO_SENSORS_PAJ7620_INT_GPIO >= 0
        if (gpio_get_level((gpio_num_t)CONFIG_ECHO_SENSORS_PAJ7620_INT_GPIO) != 0) {
            vTaskDelay(pdMS_TO_TICKS(PAJ_POLL_MS));
            continue;
        }
#endif
        (void)poll_once();
        vTaskDelay(pdMS_TO_TICKS(PAJ_POLL_MS));
    }
}

esp_err_t echo_sensor_paj7620_start(void)
{
    ESP_RETURN_ON_ERROR(paj_write_u8(PAJ_REG_BANK_SEL, 0x00), TAG, "bank 0 select");

    uint8_t id[2] = {0};
    ESP_RETURN_ON_ERROR(paj_read(PAJ_REG_PART_ID0, id, sizeof(id)), TAG, "part id");
    if (id[0] != PAJ_PART_ID0_VAL || id[1] != PAJ_PART_ID1_VAL) {
        ESP_LOGE(TAG, "unexpected part id 0x%02X 0x%02X at 0x%02X", id[0], id[1],
                 (unsigned)PAJ_ADDR);
        return ESP_ERR_NOT_FOUND;
    }

    for (size_t i = 0; i < sizeof(k_init_regs) / sizeof(k_init_regs[0]); i++) {
        ESP_RETURN_ON_ERROR(paj_write_u8(k_init_regs[i][0], k_init_regs[i][1]), TAG,
                            "init register write");
    }
    ESP_LOGI(TAG, "PAJ7620U2 at 0x%02X initialised", (unsigned)PAJ_ADDR);

#if CONFIG_ECHO_SENSORS_PAJ7620_INT_GPIO >= 0
    const gpio_config_t int_cfg = {
        .pin_bit_mask = 1ULL << CONFIG_ECHO_SENSORS_PAJ7620_INT_GPIO,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE, /* open-drain, active low */
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&int_cfg), TAG, "INT GPIO");
#endif

    if (xTaskCreate(paj7620_task, "echo_gesture", PAJ_TASK_STACK, NULL,
                    PAJ_TASK_PRIO, &s_task) != pdPASS) {
        return ESP_ERR_NO_MEM;
    }

    s_ready = true;
    return ESP_OK;
}

bool echo_sensor_paj7620_ready(void)
{
    return s_ready;
}

#else /* !CONFIG_ECHO_SENSORS_PAJ7620_ENABLED */

esp_err_t echo_sensor_paj7620_start(void)
{
    return ESP_OK;
}

bool echo_sensor_paj7620_ready(void)
{
    return false;
}

#endif /* CONFIG_ECHO_SENSORS_PAJ7620_ENABLED */
