/*
 * Echo-Cook Wi-Fi station bring-up (ESP32-P4 host, ESP32-C6 slave over SDIO).
 *
 * The P4 has no radio: `esp_wifi_remote` re-implements the `esp_wifi_*` API on
 * top of `esp_hosted`, so this component is plain ESP-IDF station code. Nothing
 * here knows about SDIO, RPC or the C6 — only the Kconfig wiring does.
 *
 * Connectivity is published on the event bus (`ECHO_EVT_NET_STATUS`), so no
 * other component has to poll `echo_wifi_is_connected()`.
 *
 * Note: `echo_wifi_init()` talks to the co-processor. It fails with a timeout /
 * ESP_FAIL when the C6 does not run the ESP-Hosted slave firmware, which is
 * reported (not fatal) so the UI can still boot headless.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/** @brief Initialise netif + `esp_wifi`. Idempotent. Without credentials it fails. */
esp_err_t echo_wifi_init(void);

/** @brief Create the station and start connecting. Requires echo_wifi_init(). */
esp_err_t echo_wifi_start(void);

/** @brief echo_wifi_init() + echo_wifi_start(); returns the first failure. */
esp_err_t echo_wifi_connect(void);

/** @brief Stop retrying and drop the current association. */
esp_err_t echo_wifi_disconnect(void);

/** @brief True once an IP address has been obtained. */
bool echo_wifi_is_connected(void);

/**
 * @brief Block until connected or @p timeout_ms elapsed.
 *
 * @return true when connected. Call it from a task, never from an event handler.
 */
bool echo_wifi_wait_connected(uint32_t timeout_ms);

/** @brief Copy the current IPv4 address ("0.0.0.0" when down) into @p buf. */
esp_err_t echo_wifi_get_ip(char *buf, size_t size);

/** @brief Copy the station MAC (lowercase aa:bb:cc:dd:ee:ff) into @p buf. */
esp_err_t echo_wifi_get_mac(char *buf, size_t size);

/** @brief RSSI of the current AP, or 0 when not connected. */
int8_t echo_wifi_rssi(void);

/** @brief SSID from Kconfig (may be empty when the station is unconfigured). */
const char *echo_wifi_ssid(void);

/** @brief Failed connection attempts since the last successful association. */
int32_t echo_wifi_retry_count(void);

/**
 * @brief Start SNTP so time() returns wall-clock time.
 *
 * Called automatically once the station obtains an IP address; safe to call
 * again (idempotent). A no-op when CONFIG_ECHO_WIFI_NTP_ENABLED is off.
 */
esp_err_t echo_wifi_time_start(void);

/** @brief True once an NTP reply has set the system clock. */
bool echo_wifi_time_synced(void);

/**
 * @brief Copy the local time as "HH:MM:SS" into @p buf.
 *
 * Writes "--:--:--" and returns ESP_ERR_INVALID_STATE while the clock is not
 * synced yet. The timezone comes from CONFIG_ECHO_WIFI_TZ.
 */
esp_err_t echo_wifi_time_str(char *buf, size_t size);

#ifdef __cplusplus
}
#endif
