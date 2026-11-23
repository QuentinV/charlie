/*
 * Echo-Cook dual-display facade.
 *
 * MAIN : 10.1" Waveshare DSI panel, JD9365, 800x1280, RGB888, touch capable.
 * AUX  : 3.5" SPI TFT, 480x320, ST7796 (RGB565) or ILI9488 (RGB666), no touch.
 *
 * Pixel data accepted by this API is always RGB565 so callers (LVGL, recipe
 * renderer) never deal with panel-specific formats. The DSI driver expands to
 * BGR888 in its own framebuffer; the SPI driver sends RGB565 natively on the
 * ST7796 and expands to RGB666 only on the ILI9488.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "esp_lcd_types.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Which panel an operation targets. Values match echo_screen_t in echo_core. */
typedef enum {
    ECHO_DISPLAY_MAIN = 0, /*!< 10.1" DSI, 800x1280, touch.   */
    ECHO_DISPLAY_AUX  = 1, /*!< 3.5" SPI, ST7796/ILI9488. */
} echo_display_id_t;

#define ECHO_DISPLAY_MAIN_H_RES   800
#define ECHO_DISPLAY_MAIN_V_RES   1280
#define ECHO_DISPLAY_AUX_H_RES    480
#define ECHO_DISPLAY_AUX_V_RES    320

/**
 * @brief Bring up every panel enabled in menuconfig (echo_display).
 *
 * Failure of one panel does not prevent the other from coming up; the function
 * returns the first error but each panel's state can be queried with
 * echo_display_ready().
 */
esp_err_t echo_display_init(void);

/** @brief True when the requested panel finished initialisation. */
bool echo_display_ready(echo_display_id_t id);

/** @brief Panel handle (for esp_lcd_panel_draw_bitmap / LVGL ports), or NULL. */
esp_lcd_panel_handle_t echo_display_panel(echo_display_id_t id);

/**
 * @brief Native DSI framebuffer pointer (BGR888, 800*1280*3 bytes).
 *
 * Zero-copy drawing: write pixels here and call
 * esp_lcd_panel_draw_bitmap(panel, 0, 0, 800, 1280, fb) to flush the cache.
 * Returns NULL when the DSI panel is disabled or failed to start.
 */
void *echo_display_main_framebuffer(void);

/**
 * @brief Fill a panel with one RGB565 colour.
 */
esp_err_t echo_display_clear(echo_display_id_t id, uint16_t rgb565);

/**
 * @brief Blit an RGB565 rectangle. x_end/y_end are exclusive.
 *
 * Pixels are converted to the panel's native format inside this call. The
 * source buffer may be freed as soon as the call returns.
 */
esp_err_t echo_display_draw_rgb565(echo_display_id_t id, int x_start, int y_start,
                                   int x_end, int y_end, const uint16_t *pixels);

/**
 * @brief Paint a solid boot screen on every ready panel.
 *
 * Colour is deliberately neutral so a dark panel is distinguishable from a
 * dead one during board bring-up.
 */
esp_err_t echo_display_show_boot_screen(void);

/**
 * @brief Start touch input for the 10.1" DSI panel.
 *
 * Only the DSI panel has a touch controller; the 3.5" SPI module does not.
 * The controller (GT911/GT9271, register compatible) shares the I2C bus the
 * Waveshare JD9365 driver already installed on I2C_NUM_1 (SDA=GPIO7, SCL=GPIO8),
 * so this must run after echo_display_init() succeeded for ECHO_DISPLAY_MAIN.
 *
 * A dedicated task polls the controller every 20 ms and publishes
 * ECHO_EVT_GESTURE events (tap / swipe left / right / up / down) on the event
 * bus. Nothing is drawn from that task.
 */
esp_err_t echo_display_touch_init(void);

/** @brief True when the touch task is polling a controller that ACKed. */
bool echo_display_touch_ready(void);

/** Latest decoded touch state, in panel pixels (0..799, 0..1279). */
typedef struct {
    bool    pressed; /*!< Finger currently down. */
    int32_t x;       /*!< Last reported column. */
    int32_t y;       /*!< Last reported row.    */
} echo_touch_point_t;

/**
 * @brief Read the latest touch sample without blocking.
 *
 * Used by the LVGL pointer indev, which needs press/move/release rather than the
 * classified gestures published on the event bus. The state is kept up to date
 * by the touch task, so this returns immediately and is safe to call from any
 * task. When touch is disabled or failed to start, it returns false and leaves
 * @p point untouched.
 */
bool echo_display_touch_read(echo_touch_point_t *point);

#ifdef __cplusplus
}
#endif
