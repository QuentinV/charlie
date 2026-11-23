/*
 * Echo-Cook screen bundle renderer — device side of `ui.bundle/1`.
 *
 * The device pulls its whole UI from Charlie over HTTP, caches it in SPIFFS and
 * renders it with LVGL. Nothing is pushed over the WebSocket: the device polls
 * the revision, downloads the bundle when its hash changed, resolves its
 * variables (locally, or in batches from Charlie) and runs every action itself.
 * Only `call` actions travel back to Charlie.
 *
 * Contract: charlie/nodejs-apis/src/echo/ui/schema.ts (mirrored in
 * echo_screen_schema.h). Until a bundle arrives the panels keep showing the
 * "Waiting for UI from Charlie" message painted by echo_ui.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#include "echo_events.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Start the bundle renderer.
 *
 * Reads the cached bundle from SPIFFS (if any) and renders it immediately, so a
 * device that has already talked to Charlie paints its UI before Wi-Fi is up.
 * Then starts the fetch task that polls Charlie for revisions. Requires
 * echo_ui_init() and echo_storage_init() to have run.
 */
esp_err_t echo_screen_init(void);

/** @brief True once the renderer has a parsed bundle (cached or fetched). */
bool echo_screen_ready(void);

/** @brief Revision currently rendered, 0 when no bundle is loaded. */
uint32_t echo_screen_rev(void);

/**
 * @brief Ask the fetch task to poll Charlie now instead of waiting for the next
 *        interval. Safe to call from any task.
 */
esp_err_t echo_screen_reload(void);

/**
 * @brief Switch a panel to a page by id, using the local page stack.
 *
 * Runs on the UI task. Returns ESP_ERR_NOT_FOUND when the bundle has no such
 * page, or when the page does not target that panel.
 */
esp_err_t echo_screen_navigate(echo_screen_t panel, const char *page_id);

/** @brief Go back one page on a panel (no-op when the stack is empty). */
esp_err_t echo_screen_back(echo_screen_t panel);

/* ------------------------------------------------------- variable providers */

/**
 * @brief Getter for a device-local variable (`core.*`).
 *
 * Writes a NUL-terminated string into @p out and returns ESP_OK. Returning
 * anything else leaves the previous value in place.
 */
typedef esp_err_t (*echo_var_getter_t)(char *out, size_t size, void *ctx);

/**
 * @brief Register a local variable provider.
 *
 * The bundle declares `core.*` variables; the owning component registers the
 * getter so no polling is needed. Registering the same path twice replaces the
 * previous provider. Call before or after echo_screen_init() — both work.
 */
esp_err_t echo_screen_var_register(const char *path, echo_var_getter_t getter, void *ctx);

/** @brief Unregister a provider. */
esp_err_t echo_screen_var_unregister(const char *path);

/**
 * @brief Push a value into the variable store (local variables only).
 *
 * Updates every widget bound to @p path on the next UI-task iteration. Use this
 * for events that arrive outside a getter (button presses, network status).
 */
esp_err_t echo_screen_var_set(const char *path, const char *value);

/** @brief Last known value of a variable, or NULL when unknown. */
const char *echo_screen_var_get(const char *path);

#ifdef __cplusplus
}
#endif
