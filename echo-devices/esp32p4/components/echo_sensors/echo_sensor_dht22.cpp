/*
 * DHT22 (AM2302) temperature / humidity probe, bit-banged on one GPIO.
 *
 * Protocol per read:
 *   host  : pull the line low for >= 1 ms, release it (pull-up takes over)
 *   sensor: 80 us low, 80 us high
 *   sensor: 40 bits, each a 50 us low followed by a high of 26-28 us (0) or
 *           ~70 us (1); five bytes, the last one the checksum
 *
 * Timing is measured with esp_timer_get_time() instead of a hard-coded cycle
 * count, so the driver does not depend on the CPU frequency. The read runs with
 * interrupts enabled on purpose: masking them for the ~5 ms a frame takes would
 * stall the SDIO link to the C6. A glitched frame fails the checksum and is
 * simply retried on the next period; three failed frames in a row are published
 * as an invalid sample so consumers can grey the value out.
 */
#include "echo_sensors_internal.h"

#include <string.h>

#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

#ifdef CONFIG_ECHO_SENSORS_DHT22_ENABLED

#include "echo_events.h"

static const char *TAG = "echo_dht22";

#define DHT_GPIO        ((gpio_num_t)CONFIG_ECHO_SENSORS_DHT22_GPIO)
#define DHT_PERIOD_MS   CONFIG_ECHO_SENSORS_DHT22_PERIOD_MS
#define DHT_TASK_STACK  3072
#define DHT_TASK_PRIO   3

/* Frame timing in microseconds. */
#define DHT_START_LOW_US    1200
#define DHT_RELEASE_US      40
#define DHT_EDGE_TIMEOUT_US 120
#define DHT_ONE_MIN_US      48   /* high longer than this is a 1 bit */

/* Plausibility window: -40.0..80.0 degC and 0..100.0 %RH. */
#define DHT_TEMP_RAW_MIN    (-400)
#define DHT_TEMP_RAW_MAX    800
#define DHT_HUM_RAW_MAX     1000

static TaskHandle_t s_task;
static volatile bool s_ready;

/* Last good sample, written by the reader task only. */
static portMUX_TYPE s_last_mux = portMUX_INITIALIZER_UNLOCKED;
static int32_t s_last_milli_celsius;
static uint16_t s_last_humidity_permille;

/* Block until the line reaches `level`, or `timeout_us` elapse. On success the
 * timestamp of the transition is stored in `stamp_us` when non-NULL. */
static bool wait_level(int level, int timeout_us, int64_t *stamp_us)
{
    const int64_t start = esp_timer_get_time();
    while (gpio_get_level(DHT_GPIO) != level) {
        if ((int)(esp_timer_get_time() - start) > timeout_us) {
            return false;
        }
    }
    if (stamp_us != NULL) {
        *stamp_us = esp_timer_get_time();
    }
    return true;
}

/* One full transaction. Returns ESP_OK only when the checksum matched. */
static esp_err_t dht22_read_frame(uint8_t out[5])
{
    uint8_t data[5] = {0};

    /* Start signal: the sensor only answers a low of at least 1 ms. */
    ESP_RETURN_ON_ERROR(gpio_set_direction(DHT_GPIO, GPIO_MODE_OUTPUT), TAG, "dir out");
    ESP_RETURN_ON_ERROR(gpio_set_level(DHT_GPIO, 0), TAG, "start low");
    esp_rom_delay_us(DHT_START_LOW_US);
    ESP_RETURN_ON_ERROR(gpio_set_level(DHT_GPIO, 1), TAG, "release");
    ESP_RETURN_ON_ERROR(gpio_set_direction(DHT_GPIO, GPIO_MODE_INPUT), TAG, "dir in");
    esp_rom_delay_us(DHT_RELEASE_US);

    /* 80 us low + 80 us high handshake. */
    if (!wait_level(0, DHT_EDGE_TIMEOUT_US, NULL) ||
        !wait_level(1, DHT_EDGE_TIMEOUT_US, NULL)) {
        return ESP_ERR_TIMEOUT;
    }

    for (int bit = 0; bit < 40; bit++) {
        if (!wait_level(0, DHT_EDGE_TIMEOUT_US, NULL)) {
            return ESP_ERR_TIMEOUT;
        }
        int64_t rise_us = 0;
        int64_t fall_us = 0;
        if (!wait_level(1, DHT_EDGE_TIMEOUT_US, &rise_us) ||
            !wait_level(0, DHT_EDGE_TIMEOUT_US, &fall_us)) {
            return ESP_ERR_TIMEOUT;
        }
        data[bit / 8] <<= 1;
        if ((fall_us - rise_us) > DHT_ONE_MIN_US) {
            data[bit / 8] |= 1;
        }
    }

    const uint8_t checksum = (uint8_t)(data[0] + data[1] + data[2] + data[3]);
    if (checksum != data[4]) {
        ESP_LOGD(TAG, "checksum mismatch (0x%02X != 0x%02X)", checksum, data[4]);
        return ESP_ERR_INVALID_CRC;
    }
    memcpy(out, data, sizeof(data));
    return ESP_OK;
}

static void publish(bool valid, int32_t milli_celsius, uint16_t humidity_permille)
{
    const echo_temperature_t evt = {
        .milli_celsius = milli_celsius,
        .humidity_permille = humidity_permille,
        .valid = valid,
    };
    const esp_err_t err = echo_event_bus_post(ECHO_EVT_TEMPERATURE, &evt, sizeof(evt));
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "event post failed: %s", esp_err_to_name(err));
    }
}

static esp_err_t read_and_publish(void)
{
    uint8_t frame[5];
    esp_err_t err = ESP_FAIL;

    /* Up to three attempts: a single glitched frame is normal on a shared bus. */
    for (int attempt = 0; attempt < 3; attempt++) {
        err = dht22_read_frame(frame);
        if (err == ESP_OK) {
            break;
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
    if (err != ESP_OK) {
        /* Keep the last good values in the payload but flag them as stale. */
        publish(false, s_last_milli_celsius, s_last_humidity_permille);
        return err;
    }

    const uint16_t hum_raw = (uint16_t)((frame[0] << 8) | frame[1]);
    const bool negative = (frame[2] & 0x80) != 0;
    int32_t temp_raw = (int32_t)(((frame[2] & 0x7F) << 8) | frame[3]);
    if (negative) {
        temp_raw = -temp_raw;
    }

    if (hum_raw > DHT_HUM_RAW_MAX || temp_raw < DHT_TEMP_RAW_MIN ||
        temp_raw > DHT_TEMP_RAW_MAX) {
        ESP_LOGW(TAG, "out-of-range sample (%ld, %u)", (long)temp_raw, (unsigned)hum_raw);
        publish(false, s_last_milli_celsius, s_last_humidity_permille);
        return ESP_ERR_INVALID_RESPONSE;
    }

    /* Sensor units are 0.1 degC and 0.1 %RH; 1000 of each make the published unit. */
    const int32_t milli_celsius = temp_raw * 100;
    const uint16_t humidity_permille = hum_raw; /* 0.1 % == 1 permille */

    taskENTER_CRITICAL(&s_last_mux);
    s_last_milli_celsius = milli_celsius;
    s_last_humidity_permille = humidity_permille;
    taskEXIT_CRITICAL(&s_last_mux);

    if (!s_ready) {
        s_ready = true;
        ESP_LOGI(TAG, "DHT22 on GPIO%d: %ld.%01ld degC, %u.%01u %%RH",
                 CONFIG_ECHO_SENSORS_DHT22_GPIO,
                 (long)(milli_celsius / 1000),
                 (long)((milli_celsius % 1000 + 1000) % 1000) / 100,
                 (unsigned)(humidity_permille / 1000),
                 (unsigned)((humidity_permille % 1000) / 100));
    }

    publish(true, milli_celsius, humidity_permille);
    return ESP_OK;
}

static void dht22_task(void *arg)
{
    (void)arg;
    ESP_LOGI(TAG, "polling every %d ms", DHT_PERIOD_MS);

    uint32_t consecutive_failures = 0;
    while (true) {
        const esp_err_t err = read_and_publish();
        if (err == ESP_OK) {
            if (consecutive_failures > 0) {
                ESP_LOGI(TAG, "probe recovered after %u failed reads",
                         (unsigned)consecutive_failures);
            }
            consecutive_failures = 0;
        } else {
            consecutive_failures++;
            /* Log the first failure and then every tenth, so an unplugged probe
             * cannot flood the console. */
            if (consecutive_failures == 1 || (consecutive_failures % 10) == 0) {
                ESP_LOGW(TAG, "read failed (%s, %u in a row)", esp_err_to_name(err),
                         (unsigned)consecutive_failures);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(DHT_PERIOD_MS));
    }
}

esp_err_t echo_sensor_dht22_start(void)
{
    const gpio_config_t cfg = {
        .pin_bit_mask = 1ULL << CONFIG_ECHO_SENSORS_DHT22_GPIO,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE, /* the module's own pull-up is weak */
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&cfg), TAG, "data GPIO");
    ESP_RETURN_ON_ERROR(gpio_set_level(DHT_GPIO, 1), TAG, "idle high");

    if (xTaskCreate(dht22_task, "echo_dht22", DHT_TASK_STACK, NULL,
                    DHT_TASK_PRIO, &s_task) != pdPASS) {
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

bool echo_sensor_dht22_ready(void)
{
    return s_ready;
}

bool echo_sensor_dht22_last(int32_t *milli_celsius, uint16_t *humidity_permille)
{
    if (!s_ready) {
        return false;
    }
    taskENTER_CRITICAL(&s_last_mux);
    if (milli_celsius != NULL) {
        *milli_celsius = s_last_milli_celsius;
    }
    if (humidity_permille != NULL) {
        *humidity_permille = s_last_humidity_permille;
    }
    taskEXIT_CRITICAL(&s_last_mux);
    return true;
}

#else /* !CONFIG_ECHO_SENSORS_DHT22_ENABLED */

esp_err_t echo_sensor_dht22_start(void)
{
    return ESP_OK;
}

bool echo_sensor_dht22_ready(void)
{
    return false;
}

bool echo_sensor_dht22_last(int32_t *milli_celsius, uint16_t *humidity_permille)
{
    (void)milli_celsius;
    (void)humidity_permille;
    return false;
}

#endif /* CONFIG_ECHO_SENSORS_DHT22_ENABLED */
