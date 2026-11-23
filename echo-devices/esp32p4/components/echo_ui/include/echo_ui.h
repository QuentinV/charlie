/*
 * Echo-Cook LVGL UI layer.
 *
 * Owns the two LVGL displays (10.1" DSI panel and 3.5" SPI panel), the touch
 * indev and the single UI task. It no longer draws application UI itself: the
 * screen bundle renderer (echo_screen) builds the widgets and asks this layer
 * to put them on a display.
 *
 *   * the panels stay behind echo_display's RGB565 blit API, so no panel driver
 *     details leak in here;
 *   * the UI task owns every LVGL call (LVGL is built with LV_OS_NONE); the rest
 *     of the firmware talks to it through a command queue or the service hook;
 *   * until a bundle has been received the layer shows "Waiting for UI from
 *     Charlie" on both panels, so the screen is never blank.
 *
 * Fonts: bundled DejaVu Sans (see fonts/README.md) covering Latin-1 plus the
 * punctuation the UI uses, so French accents render.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "lvgl.h"

#include "echo_events.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Create the LVGL displays, the touch indev and the UI task.
 *
 * Requires echo_display_init() (and, for touch, echo_display_touch_init()) to
 * have run. At least one ready panel is needed; with none the call fails with
 * ESP_ERR_INVALID_STATE. The "waiting for UI" message is painted here.
 */
esp_err_t echo_ui_init(void);

/** @brief True once the UI task is servicing LVGL timers. */
bool echo_ui_ready(void);

/**
 * @brief Show a plain message on both panels.
 *
 * Used as the offline fallback and for fatal/blocking states. Safe to call from
 * any task; the labels are updated on the UI task. Strings are copied.
 */
esp_err_t echo_ui_show_message(const char *title, const char *body);

/**
 * @brief Service callback, run on the UI task inside the LVGL lock.
 *
 * The bundle renderer uses this to apply pending work (page swaps, variable
 * updates) without taking the lock itself and without racing the UI task.
 * Keep it short: it runs on every task iteration, before LVGL's timer handler.
 */
typedef void (*echo_ui_service_fn_t)(void *ctx);

/** @brief Install (or clear, with NULL) the service callback. */
esp_err_t echo_ui_set_service_hook(echo_ui_service_fn_t fn, void *ctx);

/** @brief LVGL display of a panel, or NULL when that panel is not ready. */
lv_display_t *echo_ui_display(echo_screen_t screen);

/**
 * @brief Root screen currently owned by this layer for a panel.
 *
 * The "waiting for UI" screen. The renderer may reuse it as its own root, or
 * create a new screen and hand it over with echo_ui_screen_load().
 */
lv_obj_t *echo_ui_screen_root(echo_screen_t screen);

/**
 * @brief Put a caller-built screen on a panel.
 *
 * The screen must have been created while that panel's display was the default
 * one (see echo_ui_display()). Takes the LVGL lock internally.
 */
esp_err_t echo_ui_screen_load(echo_screen_t screen, lv_obj_t *scr);

/**
 * @brief Take the LVGL lock for a task that needs to touch widgets directly.
 *
 * Returns false on timeout. Always pair with echo_ui_unlock(). Prefer the
 * service hook: it already runs under the lock.
 */
bool echo_ui_lock(uint32_t timeout_ms);

/** @brief Release the LVGL lock. */
void echo_ui_unlock(void);

#ifdef __cplusplus
}
#endif