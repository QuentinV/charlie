/*
 * echo_status — boot diagnostics screen for Echo-Cook.
 *
 * A one-shot task that waits for the boot to settle, then paints a status page
 * on the 10.1" panel (free RAM/PSRAM, Wi-Fi, time, sensors, panels, microphone
 * and speaker) plus a "Welcome to EchoCook" message on the 3.5" panel. Both are
 * held for a configurable window and then handed back to whoever owned the
 * screen before (the Charlie bundle renderer, or echo_ui's "waiting for UI").
 *
 * The component is a *sibling* of echo_screen, not a second UI owner: it never
 * builds a display or a task of its own beyond the one shot, and every LVGL call
 * happens under echo_ui's lock, reusing echo_ui's fonts.
 */
#pragma once

#include <stdbool.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Schedule the boot status screen.
 *
 * Requires echo_ui_init() to have run (at least one ready panel). Starts the
 * one-shot task; it returns immediately and needs no further servicing.
 */
esp_err_t echo_status_init(void);

/** @brief True once the status task has been created. */
bool echo_status_ready(void);

#ifdef __cplusplus
}
#endif
