/*
 * Echo-Cook Charlie-server client (Home Assistant bridge).
 *
 * Port of the Arduino `ESP32HomeAssistant` library to ESP-IDF. Only the network
 * protocol is ported: the panel, LED, microphone and speaker stay in their own
 * components. Audio is exchanged through callbacks, so this component builds and
 * runs on a board without I2S wired up.
 *
 * Protocol (kept byte-compatible with Charlie server, see docs/P0_INFRASTRUCTURE.md):
 *   url      ws://<server>:9303/ws/echo
 *   device-> start | <16-bit PCM binary frames> | end        (one utterance)
 *            {"c":"versions","v":{"lib","device","type","mac"}} on every connect
 *   server-> playAudio{conversation,timeout}, setWakeUpWordAccuracy{v},
 *            setServerIp{v}, OTA, feedback{v}, updateDisplays{v:[{k,texts}]},
 *            getVersions, plus binary TTS audio frames
 *
 * The MAC address is the stable identity of the device: the server keys its echo
 * settings by MAC, so they survive a DHCP lease change.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define ECHO_HA_DEFAULT_PORT        9303
#define ECHO_HA_WS_PATH             "/ws/echo"
#define ECHO_HA_LIBRARY_VERSION     "0.1.0"
#define ECHO_HA_DEVICE_TYPE         "echo-cook"
/** Longest feedback string accepted; matches echo_ha_text_t::text. */
#define ECHO_HA_TEXT_MAX            96

/**
 * @brief Audio hooks. Both callbacks run on the WebSocket task: copy the PCM and
 *        return quickly (an I2S write of one chunk is fine, a full TTS turn is not).
 */
typedef struct {
    /** @brief `playAudio` received: start/queue playback, remember @p follow_up. */
    void (*on_play_audio)(bool follow_up, void *ctx);
    /** @brief One binary TTS chunk (16-bit PCM, little endian, 22050 Hz mono). */
    void (*on_tts_audio)(const uint8_t *pcm, size_t len, void *ctx);
    void *ctx;
} echo_ha_callbacks_t;

/** @brief Load persisted server address (or the Kconfig default). Idempotent. */
esp_err_t echo_ha_init(void);

/** @brief Start the WebSocket client. Retries on its own once Wi-Fi is up. */
esp_err_t echo_ha_start(void);

/** @brief Stop the client and forget that it is connected. */
esp_err_t echo_ha_stop(void);

/** @brief True once the WebSocket handshake completed. */
bool echo_ha_is_connected(void);

/**
 * @brief Point the client at another Charlie server and persist the change.
 *
 * Blocks briefly to stop the running client before reconnecting, so call it from
 * application code only — never from an event or audio callback.
 */
esp_err_t echo_ha_set_server(const char *ip, uint16_t port);

/** @brief Copy the active server address; @p port may be NULL. */
esp_err_t echo_ha_get_server(char *ip, size_t size, uint16_t *port);

/** @brief Send the "start" marker that opens an utterance upload. */
esp_err_t echo_ha_send_utterance_start(void);

/** @brief Send one chunk of recorded 16-bit PCM (any length, even preferred). */
esp_err_t echo_ha_send_utterance_audio(const void *pcm, size_t len);

/** @brief Send the "end" marker that asks the server for a reply. */
esp_err_t echo_ha_send_utterance_end(void);

/** @brief Publish the `versions` payload (also sent automatically on connect). */
esp_err_t echo_ha_send_versions(void);

/** @brief Install the audio callbacks; passing NULL clears them. */
void echo_ha_set_callbacks(const echo_ha_callbacks_t *callbacks);

/** @brief Station MAC as lowercase aa:bb:cc:dd:ee:ff ("00:00:..." before init). */
const char *echo_ha_mac(void);

/** @brief Wake word threshold last requested by the server (0..1000). */
uint16_t echo_ha_wake_accuracy_permille(void);

#ifdef __cplusplus
}
#endif
