/*
 * Touch input for the 10.1" DSI panel only. The 3.5" SPI module has no touch
 * controller, so nothing here applies to ECHO_DISPLAY_AUX.
 *
 * The Waveshare JD9365 driver installs the legacy I2C driver on I2C_NUM_1
 * (SDA=GPIO7, SCL=GPIO8, 100 kHz) for its power-on sequence and never releases
 * it. That bus is shared by the capacitive touch controller (GT911 / GT9271,
 * register-compatible), so this file talks to the port that is already
 * installed instead of calling i2c_driver_install() again — a second install on
 * the same port would fail.
 *
 * The controller's 7-bit address is 0x5D or 0x14 depending on how the module
 * straps its INT/RST lines. Kconfig selects the primary address; the other is
 * probed as a fallback on the first read.
 */
#include "echo_display_internal.h"

#include <string.h>

#include "driver/i2c.h"
#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

#ifdef CONFIG_ECHO_DISPLAY_TOUCH_ENABLED

#include "echo_display.h"
#include "echo_events.h"

static const char *TAG = "echo_touch";

/* GT911 register map (same for GT9271). */
#define GT_REG_STATUS       0x814E /* bit7 = buffer ready, bits0-3 = point count */
#define GT_REG_POINT1       0x8150 /* first point: id, x_lo, x_hi, y_lo, y_hi, size */
#define GT_POINT_BYTES      8

#define TOUCH_I2C_PORT      I2C_NUM_1
#define TOUCH_I2C_TIMEOUT   pdMS_TO_TICKS(50)
#define TOUCH_POLL_MS       20
#define TOUCH_TASK_STACK    4096
#define TOUCH_TASK_PRIO     4

/* A drag shorter than this is a tap; a longer one becomes a swipe. */
#define TOUCH_TAP_MAX_MS    350
#define TOUCH_SWIPE_MIN_PX  60

static TaskHandle_t s_task;
static bool s_ready;
static uint8_t s_addr = CONFIG_ECHO_DISPLAY_TOUCH_I2C_ADDR;

/* Latest sample for the LVGL pointer indev. Written by the touch task only,
 * copied under a spinlock because LVGL reads it from a different task. */
static portMUX_TYPE s_point_mux = portMUX_INITIALIZER_UNLOCKED;
static echo_touch_point_t s_point;

/* Contact tracking, used only to classify tap vs. swipe on release. */
static struct {
    bool active;
    int start_x;
    int start_y;
    int last_x;
    int last_y;
    TickType_t start_ticks;
} s_track;

/* Read `len` bytes starting at 16-bit register `reg` into buf. */
static esp_err_t gt_read(uint16_t reg, uint8_t *buf, size_t len)
{
    const uint8_t reg_bytes[2] = { (uint8_t)(reg >> 8), (uint8_t)(reg & 0xFF) };
    return i2c_master_write_read_device(TOUCH_I2C_PORT, s_addr, reg_bytes,
                                        sizeof(reg_bytes), buf, len, TOUCH_I2C_TIMEOUT);
}

static esp_err_t gt_write_u8(uint16_t reg, uint8_t value)
{
    const uint8_t payload[3] = { (uint8_t)(reg >> 8), (uint8_t)(reg & 0xFF), value };
    return i2c_master_write_to_device(TOUCH_I2C_PORT, s_addr, payload, sizeof(payload),
                                      TOUCH_I2C_TIMEOUT);
}

/* Probe the configured address, then the alternate strap address. */
static esp_err_t gt_probe(void)
{
    uint8_t status = 0;
    esp_err_t err = gt_read(GT_REG_STATUS, &status, 1);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "touch controller at 0x%02X", s_addr);
        return ESP_OK;
    }
    const uint8_t alternate = (s_addr == 0x5D) ? 0x14 : 0x5D;
    ESP_LOGW(TAG, "no ACK at 0x%02X (%s), probing 0x%02X", s_addr, esp_err_to_name(err),
             alternate);
    s_addr = alternate;
    err = gt_read(GT_REG_STATUS, &status, 1);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "touch controller at 0x%02X", s_addr);
        return ESP_OK;
    }
    ESP_LOGE(TAG, "touch controller not found on I2C%d", TOUCH_I2C_PORT);
    return err;
}

static void post_gesture(echo_gesture_kind_t kind, int x, int y)
{
    const echo_gesture_t evt = {
        .screen = ECHO_SCREEN_MAIN,
        .kind = kind,
        .x = x,
        .y = y,
    };
    esp_err_t err = echo_event_bus_post(ECHO_EVT_GESTURE, &evt, sizeof(evt));
    if (err != ESP_OK) {
        ESP_LOGD(TAG, "gesture post failed: %s", esp_err_to_name(err));
    }
}

/* Classify a completed touch and publish the matching gesture event. */
static void finish_touch(void)
{
    const TickType_t elapsed = xTaskGetTickCount() - s_track.start_ticks;
    const int x = s_track.last_x;
    const int y = s_track.last_y;
    const int dx = x - s_track.start_x;
    const int dy = y - s_track.start_y;
    const int adx = dx < 0 ? -dx : dx;
    const int ady = dy < 0 ? -dy : dy;

    if (adx >= TOUCH_SWIPE_MIN_PX && adx > ady) {
        post_gesture(dx > 0 ? ECHO_GESTURE_SWIPE_RIGHT : ECHO_GESTURE_SWIPE_LEFT, x, y);
    } else if (ady >= TOUCH_SWIPE_MIN_PX) {
        post_gesture(dy > 0 ? ECHO_GESTURE_SWIPE_DOWN : ECHO_GESTURE_SWIPE_UP, x, y);
    } else if (elapsed <= pdMS_TO_TICKS(TOUCH_TAP_MAX_MS)) {
        post_gesture(ECHO_GESTURE_TAP, x, y);
    }
}

/*
 * One poll.
 *   > 0 : a new frame reports a contact; *x/*y hold the first point
 *   = 0 : a new frame reports no contact (finger released)
 *   < 0 : no new frame since the last poll (finger state unchanged)
 *
 * The three-way result matters: a stationary finger produces no new frames, and
 * treating that as a release would fire a tap on every holding pause.
 */
static int gt_poll(int *x, int *y)
{
    uint8_t status = 0;
    if (gt_read(GT_REG_STATUS, &status, 1) != ESP_OK) {
        return -1;
    }
    if ((status & 0x80) == 0) {
        return -1; /* no new frame */
    }

    const uint8_t points = status & 0x0F;
    int touched = 0;
    if (points > 0) {
        uint8_t pt[GT_POINT_BYTES] = {0};
        if (gt_read(GT_REG_POINT1, pt, sizeof(pt)) == ESP_OK) {
            /* Point layout: track id, x_lo, x_hi, y_lo, y_hi, size_lo, size_hi, reserved */
            *x = (int)(pt[1] | ((uint16_t)pt[2] << 8));
            *y = (int)(pt[3] | ((uint16_t)pt[4] << 8));
            touched = 1;
        }
    }

    /* Bit 7 must be cleared so the controller reports the next frame. */
    gt_write_u8(GT_REG_STATUS, 0x00);
    return touched;
}

static void set_point(bool pressed, int x, int y)
{
    taskENTER_CRITICAL(&s_point_mux);
    s_point.pressed = pressed;
    s_point.x = x;
    s_point.y = y;
    taskEXIT_CRITICAL(&s_point_mux);
}

/* Normalise the controller's coordinates to panel pixels. Most Waveshare
 * 10.1" batches are already aligned; the Kconfig mirror/swap options exist for
 * the batches that are not. */
static void touch_map(int raw_x, int raw_y, int *out_x, int *out_y)
{
    int x = raw_x;
    int y = raw_y;
#if CONFIG_ECHO_DISPLAY_TOUCH_SWAP_XY
    const int tmp = x;
    x = y;
    y = tmp;
#endif
#if CONFIG_ECHO_DISPLAY_TOUCH_MIRROR_X
    x = ECHO_DISPLAY_MAIN_H_RES - 1 - x;
#endif
#if CONFIG_ECHO_DISPLAY_TOUCH_MIRROR_Y
    y = ECHO_DISPLAY_MAIN_V_RES - 1 - y;
#endif
    if (x < 0) {
        x = 0;
    } else if (x >= ECHO_DISPLAY_MAIN_H_RES) {
        x = ECHO_DISPLAY_MAIN_H_RES - 1;
    }
    if (y < 0) {
        y = 0;
    } else if (y >= ECHO_DISPLAY_MAIN_V_RES) {
        y = ECHO_DISPLAY_MAIN_V_RES - 1;
    }
    *out_x = x;
    *out_y = y;
}

static void touch_task(void *arg)
{
    (void)arg;
    ESP_LOGI(TAG, "touch polling started (%d ms)", TOUCH_POLL_MS);

    while (true) {
        int x = 0, y = 0;
        const int poll = gt_poll(&x, &y);
        if (poll > 0) {
            int mx = 0, my = 0;
            touch_map(x, y, &mx, &my);
            if (!s_track.active) {
                s_track.active = true;
                s_track.start_x = mx;
                s_track.start_y = my;
                s_track.start_ticks = xTaskGetTickCount();
            }
            s_track.last_x = mx;
            s_track.last_y = my;
            set_point(true, mx, my);
        } else if (poll == 0 && s_track.active) {
            /* Finger lifted: classify against the last coordinates seen. */
            s_track.active = false;
            finish_touch();
            set_point(false, s_track.last_x, s_track.last_y);
        }
        vTaskDelay(pdMS_TO_TICKS(TOUCH_POLL_MS));
    }
}

esp_err_t echo_display_touch_init(void)
{
    if (s_ready) {
        return ESP_OK;
    }

    /* The waveshare driver installs the I2C port; a missing driver means the DSI
     * panel never came up, so there is nothing to attach to. */
    esp_err_t err = gt_probe();
    if (err != ESP_OK) {
        return err;
    }

    /* Clear any stale frame left by a warm reset. */
    gt_write_u8(GT_REG_STATUS, 0x00);

    if (xTaskCreate(touch_task, "echo_touch", TOUCH_TASK_STACK, NULL,
                    TOUCH_TASK_PRIO, &s_task) != pdPASS) {
        ESP_LOGE(TAG, "touch task creation failed");
        return ESP_ERR_NO_MEM;
    }

    s_ready = true;
    return ESP_OK;
}

bool echo_display_touch_ready(void)
{
    return s_ready;
}

bool echo_display_touch_read(echo_touch_point_t *point)
{
    if (!s_ready || point == NULL) {
        return false;
    }
    taskENTER_CRITICAL(&s_point_mux);
    *point = s_point;
    taskEXIT_CRITICAL(&s_point_mux);
    return true;
}

#else /* !CONFIG_ECHO_DISPLAY_TOUCH_ENABLED */

esp_err_t echo_display_touch_init(void)
{
    return ESP_OK;
}

bool echo_display_touch_ready(void)
{
    return false;
}

bool echo_display_touch_read(echo_touch_point_t *point)
{
    (void)point;
    return false;
}

#endif /* CONFIG_ECHO_DISPLAY_TOUCH_ENABLED */
