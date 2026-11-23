/*
 * Echo-Cook event bus contract.
 *
 * All cross-component traffic goes through the default ESP-IDF event loop so that
 * producers (wake word, gesture driver, network client) never touch the display
 * or storage code directly. Handlers run on the event loop task, so they must not
 * block; hand work off to a dedicated task when it takes longer than a few ms.
 */
#pragma once

#include <stdint.h>

#include "esp_event.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Event base for every Echo-Cook event. */
ESP_EVENT_DECLARE_BASE(ECHO_EVENT);

/** Event identifiers posted on ECHO_EVENT. */
typedef enum {
    ECHO_EVT_BOOT_READY = 0,   /*!< Core services up (NVS + storage + event loop). No data.   */
    ECHO_EVT_WAKE_WORD,        /*!< Wake word detected. payload: echo_wake_word_t.            */
    ECHO_EVT_GESTURE,          /*!< Touch/swipe gesture. payload: echo_gesture_t.             */
    ECHO_EVT_UI_NAVIGATE,      /*!< Legacy: no producer since the recipe UI was removed.      */
    ECHO_EVT_RECIPE_SELECTED,  /*!< Legacy: no producer since the recipe UI was removed.      */
    ECHO_EVT_RECIPE_LOADED,    /*!< Legacy: no producer since the recipe UI was removed.      */
    ECHO_EVT_NET_STATUS,       /*!< Connectivity changed. payload: echo_net_status_t.         */
    ECHO_EVT_HA_STATUS,        /*!< Charlie server link changed. payload: echo_ha_status_t.   */
    ECHO_EVT_HA_TTS_START,     /*!< Assistant reply starts streaming. No data.                */
    ECHO_EVT_HA_TTS_END,       /*!< Assistant reply finished. payload: echo_ha_tts_t.        */
    ECHO_EVT_HA_TEXT,          /*!< Text pushed by the server. payload: echo_ha_text_t.       */
    ECHO_EVT_HA_WAKE_ACCURACY, /*!< Wake word threshold from the server. echo_ha_accuracy_t.  */
    ECHO_EVT_ERROR,            /*!< Recoverable failure. payload: echo_error_t.               */
    /* Sensors — appended so existing ids keep their values. */
    ECHO_EVT_TEMPERATURE,      /*!< Ambient sample. payload: echo_temperature_t.              */
    ECHO_EVT_AIR_GESTURE,      /*!< Air gesture. payload: echo_air_gesture_t.                 */
    /* Screen bundles — appended so existing ids keep their values. */
    ECHO_EVT_UI_BUNDLE_LOADED, /*!< Bundle parsed and cached. payload: echo_ui_bundle_t.      */
    ECHO_EVT_UI_PAGE_CHANGED,  /*!< A page became visible. payload: echo_ui_page_t.           */
    ECHO_EVT_UI_ACTION,        /*!< A widget action fired. payload: echo_ui_action_evt_t.      */
    ECHO_EVT_MAX
} echo_event_id_t;

/** Which physical panel a UI command targets. */
typedef enum {
    ECHO_SCREEN_MAIN = 0,  /*!< 10.1" DSI panel (JD9365, 800x1280) - touch. */
    ECHO_SCREEN_AUX  = 1,  /*!< 3.5" SPI panel (480x320) - no touch.          */
} echo_screen_t;

/** Screens the UI knows about. Extend together with the LVGL screen registry. */
typedef enum {
    ECHO_UI_SCREEN_IDLE = 0,
    ECHO_UI_SCREEN_RECIPES,
    ECHO_UI_SCREEN_RECIPE_DETAIL,
    ECHO_UI_SCREEN_INGREDIENTS,
    ECHO_UI_SCREEN_SETTINGS,
} echo_ui_screen_t;

/** Payload of ECHO_EVT_WAKE_WORD. */
typedef struct {
    uint32_t score_permille; /*!< 0..1000 confidence reported by the engine. */
    int64_t  timestamp_us;   /*!< esp_timer_get_time() at detection.         */
} echo_wake_word_t;

/**
 * Gesture kinds; the touch driver normalises its raw events to these.
 *
 * The four swipe directions are shared with the PAJ7620U2 air sensor (a hand
 * moving up reports ECHO_GESTURE_SWIPE_UP); the remaining values only come from
 * the air sensor and are appended so existing values stay stable.
 */
typedef enum {
    ECHO_GESTURE_TAP = 0,
    ECHO_GESTURE_SWIPE_LEFT,
    ECHO_GESTURE_SWIPE_RIGHT,
    ECHO_GESTURE_SWIPE_UP,
    ECHO_GESTURE_SWIPE_DOWN,
    ECHO_GESTURE_FORWARD,          /*!< Hand pushed towards the sensor.   */
    ECHO_GESTURE_BACKWARD,         /*!< Hand pulled away from the sensor. */
    ECHO_GESTURE_CLOCKWISE,        /*!< Circle drawn clockwise.           */
    ECHO_GESTURE_COUNTERCLOCKWISE, /*!< Circle drawn anti-clockwise.      */
    ECHO_GESTURE_WAVE,             /*!< Left/right wave in one motion.    */
} echo_gesture_kind_t;

/** Payload of ECHO_EVT_GESTURE. Coordinates are in the touch panel's own pixels. */
typedef struct {
    echo_screen_t       screen;
    echo_gesture_kind_t kind;
    int32_t             x;
    int32_t             y;
} echo_gesture_t;

/** Payload of ECHO_EVT_UI_NAVIGATE. */
typedef struct {
    echo_screen_t   screen;
    echo_ui_screen_t target;
} echo_ui_cmd_t;

/** Payload of ECHO_EVT_NET_STATUS. */
typedef struct {
    bool connected;
    int8_t rssi;
} echo_net_status_t;

/** Payload of ECHO_EVT_HA_STATUS. */
typedef struct {
    bool connected;  /*!< WebSocket to the Charlie server is up. */
} echo_ha_status_t;

/** Payload of ECHO_EVT_HA_TTS_END. */
typedef struct {
    bool follow_up;  /*!< Server asked to reopen the mic without a wake word. */
} echo_ha_tts_t;

/** Payload of ECHO_EVT_HA_TEXT (``feedback`` / ``updateDisplays`` commands). */
typedef struct {
    uint8_t screen;   /*!< 0 = feedback display, otherwise the server's screen index. */
    char    text[96]; /*!< NUL-terminated UTF-8, truncated to fit the event queue.     */
} echo_ha_text_t;

/** Payload of ECHO_EVT_HA_WAKE_ACCURACY (``setWakeUpWordAccuracy`` command). */
typedef struct {
    uint16_t permille; /*!< Confidence threshold, 0..1000 (900 = 0.90). */
} echo_ha_accuracy_t;

/**
 * Payload of ECHO_EVT_TEMPERATURE (echo_sensors, 1 Hz-ish DHT22 polling).
 *
 * `valid == false` means the probe answered with a bad checksum or an
 * out-of-range value this period; the readings are then the last good ones, so
 * consumers can keep showing a stale value instead of blanking the screen.
 */
typedef struct {
    int32_t  milli_celsius;     /*!< 21500 = 21.5 degC.                            */
    uint16_t humidity_permille; /*!< 65500 = 65.5 %RH (DHT22 range 0..100 %RH).    */
    bool     valid;             /*!< False when this sample is stale.              */
} echo_temperature_t;

/**
 * Payload of ECHO_EVT_AIR_GESTURE (PAJ7620U2).
 *
 * `raw_flags` are the sensor's own flag bytes (registers 0x43 / 0x44) after a
 * gesture was detected, kept for diagnostics because the kind mapping is one
 * flag bit per gesture and firmware revisions differ slightly.
 */
typedef struct {
    echo_gesture_kind_t kind;         /*!< Decoded gesture.                        */
    int64_t             timestamp_us; /*!< esp_timer_get_time() at detection.      */
    uint8_t             raw_flags[2]; /*!< {register 0x43, register 0x44}.         */
} echo_air_gesture_t;

/** Payload of ECHO_EVT_ERROR. */
typedef struct {
    int32_t     code;         /*!< esp_err_t or a subsystem-specific code. */
    const char *component;    /*!< Static string owned by the producer.    */
} echo_error_t;

/** Payload of ECHO_EVT_UI_BUNDLE_LOADED. */
typedef struct {
    uint32_t rev;              /*!< Revision the device now holds.             */
    uint16_t pages;            /*!< Number of pages in the bundle.             */
    bool     from_cache;       /*!< True when served from SPIFFS, not HTTP.    */
} echo_ui_bundle_t;

/** Payload of ECHO_EVT_UI_PAGE_CHANGED. */
typedef struct {
    echo_screen_t screen;      /*!< Panel that switched.                       */
    char          page[32];    /*!< Page id now visible.                       */
} echo_ui_page_t;

/** Payload of ECHO_EVT_UI_ACTION. */
typedef struct {
    echo_screen_t screen;      /*!< Panel the widget lives on.                 */
    char          page[32];    /*!< Page id.                                   */
    char          widget[48];  /*!< Widget id, empty when the page fired it.   */
    char          action[64];  /*!< Action verb as written in the bundle.      */
} echo_ui_action_evt_t;

/**
 * @brief Create the default event loop. Safe to call twice (returns ESP_OK).
 */
esp_err_t echo_event_bus_init(void);

/** @brief Post an event with an optional copied payload. */
esp_err_t echo_event_bus_post(echo_event_id_t id, const void *data, size_t size);

/** @brief Post an event without payload. */
esp_err_t echo_event_bus_post_simple(echo_event_id_t id);

/** @brief Subscribe to one event id. */
esp_err_t echo_event_bus_subscribe(echo_event_id_t id, esp_event_handler_t handler, void *ctx);

/** @brief Subscribe to every event id on ECHO_EVENT. */
esp_err_t echo_event_bus_subscribe_all(esp_event_handler_t handler, void *ctx);

/** @brief Unsubscribe a handler. */
esp_err_t echo_event_bus_unsubscribe(echo_event_id_t id, esp_event_handler_t handler);

#ifdef __cplusplus
}
#endif
