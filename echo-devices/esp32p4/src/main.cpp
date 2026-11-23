/*
 * Echo-Cook P0 application skeleton.
 *
 * Replaces the rotating-smiley PoC. This file only wires the core services
 * together; every subsystem lives in its own component:
 *
 *   echo_core    event bus, NVS, SPIFFS "storage" partition (UI cache, assets)
 *   echo_display 10.1" DSI (JD9365, touch) + 3.5" SPI (ST7796) panels
 *   echo_wakeword "Hey Charlie" policy layer + optional TFLite engine
 *   echo_wifi    hosted Wi-Fi station (P4 -> C6 over SDIO)
 *   echo_ha      Charlie server WebSocket client, event-bus glue only here
 *   echo_sensors DHT22 temperature/humidity + PAJ7620U2 air gestures
 *   echo_ui      LVGL displays, touch indev, UI task, "waiting for UI" fallback
 *   echo_screen  screen bundle renderer: pulls the UI from Charlie and draws it
 *
 * Boot order:
 *   1. event loop  (so every later failure can be reported as an event)
 *   2. NVS + SPIFFS storage
 *   3. display panels + boot screen, touch, LVGL
 *   4. Wi-Fi station, then the Charlie server client (both non-blocking)
 *   5. sensors (they share the display's I2C bus, so they come after step 3)
 *   6. ECHO_EVT_BOOT_READY
 *
 * Nothing here draws pixels. The panels show "Waiting for UI from Charlie"
 * until the device pulls its first screen bundle over HTTP; Charlie no longer
 * pushes display content over the WebSocket.
 */

#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_partition.h"
#include "esp_system.h"

#include "echo_audio.h"
#include "echo_display.h"
#include "echo_events.h"
#include "echo_ha.h"
#include "echo_screen.h"
#include "echo_sensors.h"
#include "echo_status.h"
#include "echo_storage.h"
#include "echo_ui.h"
#include "echo_voice.h"
#include "echo_wakeword.h"
#include "echo_wakeword_tflite.h"
#include "echo_wifi.h"

static const char *TAG = "app";

/* Event logger — proves the bus is wired and helps diagnose bring-up. */
static void echo_event_logger(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    (void)base;

    switch ((echo_event_id_t)id) {
    case ECHO_EVT_BOOT_READY:
        ESP_LOGI(TAG, "event: boot ready");
        break;
    case ECHO_EVT_WAKE_WORD: {
        const echo_wake_word_t *ww = (const echo_wake_word_t *)data;
        ESP_LOGI(TAG, "event: wake word (%u permille)",
                 ww ? (unsigned)ww->score_permille : 0u);
        break;
    }
    case ECHO_EVT_GESTURE: {
        const echo_gesture_t *g = (const echo_gesture_t *)data;
        ESP_LOGI(TAG, "event: gesture %d on screen %d at (%d,%d)",
                 g ? (int)g->kind : -1, g ? (int)g->screen : -1,
                 g ? (int)g->x : -1, g ? (int)g->y : -1);
        break;
    }
    case ECHO_EVT_UI_NAVIGATE: {
        const echo_ui_cmd_t *cmd = (const echo_ui_cmd_t *)data;
        ESP_LOGI(TAG, "event: navigate screen %d -> %d",
                 cmd ? (int)cmd->screen : -1, cmd ? (int)cmd->target : -1);
        break;
    }
    case ECHO_EVT_NET_STATUS: {
        const echo_net_status_t *net = (const echo_net_status_t *)data;
        ESP_LOGI(TAG, "event: net %s (rssi %d)",
                 net && net->connected ? "up" : "down", net ? (int)net->rssi : 0);
        break;
    }
    case ECHO_EVT_HA_STATUS: {
        const echo_ha_status_t *st = (const echo_ha_status_t *)data;
        ESP_LOGI(TAG, "event: charlie server %s",
                 st && st->connected ? "connected" : "disconnected");
        break;
    }
    case ECHO_EVT_HA_TTS_START:
        ESP_LOGI(TAG, "event: assistant reply streaming");
        break;
    case ECHO_EVT_HA_TTS_END: {
        const echo_ha_tts_t *tts = (const echo_ha_tts_t *)data;
        ESP_LOGI(TAG, "event: assistant reply done%s",
                 tts && tts->follow_up ? " (follow-up)" : "");
        break;
    }
    case ECHO_EVT_HA_TEXT: {
        const echo_ha_text_t *text = (const echo_ha_text_t *)data;
        ESP_LOGI(TAG, "event: server text [%u] \"%s\"",
                 text ? (unsigned)text->screen : 0u, text ? text->text : "");
        break;
    }
    case ECHO_EVT_HA_WAKE_ACCURACY: {
        const echo_ha_accuracy_t *acc = (const echo_ha_accuracy_t *)data;
        ESP_LOGI(TAG, "event: wake accuracy %u permille",
                 acc ? (unsigned)acc->permille : 0u);
        break;
    }
    case ECHO_EVT_TEMPERATURE: {
        const echo_temperature_t *t = (const echo_temperature_t *)data;
        if (t == nullptr || !t->valid) {
            ESP_LOGW(TAG, "event: temperature stale");
            break;
        }
        ESP_LOGI(TAG, "event: %ld.%01ld degC, %u.%01u %%RH",
                 (long)(t->milli_celsius / 1000),
                 (long)((t->milli_celsius % 1000 + 1000) % 1000) / 100,
                 (unsigned)(t->humidity_permille / 1000),
                 (unsigned)((t->humidity_permille % 1000) / 100));
        break;
    }
    case ECHO_EVT_AIR_GESTURE: {
        const echo_air_gesture_t *g = (const echo_air_gesture_t *)data;
        ESP_LOGI(TAG, "event: air gesture %d (flags 0x%02X/0x%02X)",
                 g ? (int)g->kind : -1, g ? (unsigned)g->raw_flags[0] : 0u,
                 g ? (unsigned)g->raw_flags[1] : 0u);
        break;
    }
    case ECHO_EVT_ERROR: {
        const echo_error_t *evt = (const echo_error_t *)data;
        ESP_LOGE(TAG, "event: error 0x%x from %s",
                 evt ? (unsigned)evt->code : 0u,
                 evt && evt->component ? evt->component : "?");
        break;
    }
    default:
        ESP_LOGI(TAG, "event id %d", (int)id);
        break;
    }
}

/* The server owns wake word sensitivity: setWakeUpWordAccuracy arrives as an
 * event and is applied to the engine here, so echo_ha stays ignorant of audio. */
static void echo_wake_accuracy_handler(void *arg, esp_event_base_t base, int32_t id,
                                      void *data)
{
    (void)arg;
    (void)base;
    (void)id;

    const echo_ha_accuracy_t *acc = (const echo_ha_accuracy_t *)data;
    if (acc == nullptr) {
        return;
    }
    if (!echo_wakeword_is_ready()) {
        ESP_LOGW(TAG, "wake accuracy %u permille ignored: engine not initialised",
                 (unsigned)acc->permille);
        return;
    }
    esp_err_t err = echo_wakeword_set_threshold((float)acc->permille / 1000.0f);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "echo_wakeword_set_threshold: %s", esp_err_to_name(err));
    }
}

/* FreeRTOS calls app_main from C; without extern "C" the C++ name is mangled. */
extern "C" void app_main(void)
{
    ESP_LOGI(TAG, "Echo-Cook P0 booting (ESP-IDF %s)", esp_get_idf_version());

    /* 1. Event loop first: every failure below can be reported as an event. */
    esp_err_t err = echo_event_bus_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "event bus init failed: %s - aborting boot", esp_err_to_name(err));
        return;
    }
    ESP_ERROR_CHECK(echo_event_bus_subscribe_all(echo_event_logger, NULL));

    /* 2. NVS + storage. A missing/foreign "storage" partition is reported but
     *    does not stop the UI from coming up. */
    err = echo_storage_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "storage init failed: %s", esp_err_to_name(err));
        echo_error_t storage_err = {.code = err, .component = "echo_storage"};
        echo_event_bus_post(ECHO_EVT_ERROR, &storage_err, sizeof(storage_err));
    }

    /* 3. Panels. Each panel reports its own failure; the other still starts. */
    err = echo_display_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "display init returned %s", esp_err_to_name(err));
        echo_error_t disp_err = {.code = err, .component = "echo_display"};
        echo_event_bus_post(ECHO_EVT_ERROR, &disp_err, sizeof(disp_err));
    }
    ESP_LOGI(TAG, "panels: main=%s aux=%s",
             echo_display_ready(ECHO_DISPLAY_MAIN) ? "up" : "down",
             echo_display_ready(ECHO_DISPLAY_AUX) ? "up" : "down");

    if (echo_display_ready(ECHO_DISPLAY_MAIN) || echo_display_ready(ECHO_DISPLAY_AUX)) {
        err = echo_display_show_boot_screen();
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "boot screen paint failed: %s", esp_err_to_name(err));
        }
    }

    /* 3b. Touch lives on the DSI panel only; the SPI module has no controller.
     *     Needs the DSI driver's I2C bus, so it comes after echo_display_init(). */
    if (echo_display_ready(ECHO_DISPLAY_MAIN)) {
        err = echo_display_touch_init();
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "touch init failed: %s (UI still usable without input)",
                     esp_err_to_name(err));
            echo_error_t touch_err = {.code = err, .component = "echo_display_touch"};
            echo_event_bus_post(ECHO_EVT_ERROR, &touch_err, sizeof(touch_err));
        }
    }
    ESP_LOGI(TAG, "touch: %s", echo_display_touch_ready() ? "up" : "down");

    /* 3c. LVGL sits on top of the panels. It needs at least one ready panel;
     *     without one it reports the failure and the rest of the system keeps
     *     running headless. The panels are painted with "Waiting for UI from
     *     Charlie" here; the bundle renderer replaces that once it has fetched
     *     a UI. */
    err = echo_ui_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "UI init failed: %s", esp_err_to_name(err));
        echo_error_t ui_err = {.code = err, .component = "echo_ui"};
        echo_event_bus_post(ECHO_EVT_ERROR, &ui_err, sizeof(ui_err));
    }

    /* 3c2. The bundle renderer. It installs the service hook on the UI task,
     *      paints the cached bundle (if any) and starts the HTTP fetch task.
     *      A failure is not fatal: the panels keep the waiting message. */
    if (err == ESP_OK) {
        err = echo_screen_init();
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "screen bundle renderer idle: %s", esp_err_to_name(err));
            echo_error_t screen_err = {.code = err, .component = "echo_screen"};
            echo_event_bus_post(ECHO_EVT_ERROR, &screen_err, sizeof(screen_err));
        }
    }

    /* 3d. Network. Both calls return immediately after handing work to their own
     *     tasks: Wi-Fi retries in the background (SDIO link to the C6) and the
     *     Charlie client reconnects every 5 s, so a missing AP or server only
     *     costs log lines, never boot time. */
    ESP_ERROR_CHECK(echo_event_bus_subscribe(ECHO_EVT_HA_WAKE_ACCURACY,
                                             echo_wake_accuracy_handler, NULL));
#if CONFIG_ECHO_WIFI_ENABLED
    err = echo_wifi_connect();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Wi-Fi station unavailable: %s", esp_err_to_name(err));
        echo_error_t wifi_err = {.code = err, .component = "echo_wifi"};
        echo_event_bus_post(ECHO_EVT_ERROR, &wifi_err, sizeof(wifi_err));
    } else {
        /* Short, bounded wait: enough for a warm C6 to associate, short enough
         * not to delay the boot screen on a cold one. */
        bool online = echo_wifi_wait_connected(5000);
        ESP_LOGI(TAG, "wifi: %s (ssid \"%s\", retries %ld)",
                 online ? "online" : "pending", echo_wifi_ssid(),
                 (long)echo_wifi_retry_count());
    }
#else
    ESP_LOGW(TAG, "Wi-Fi disabled in Kconfig: the Charlie client stays offline");
#endif

#if CONFIG_ECHO_HA_ENABLED
    err = echo_ha_start();
    if (err != ESP_OK) {
        /* Not fatal: an unprovisioned server IP is a valid P0 state. */
        ESP_LOGW(TAG, "Charlie client idle: %s", esp_err_to_name(err));
    } else {
        ESP_LOGI(TAG, "charlie: device mac %s, ws://%s", echo_ha_mac(),
                 CONFIG_ECHO_HA_SERVER_IP[0] ? CONFIG_ECHO_HA_SERVER_IP : "(unset)");
    }
#endif

    /* 3e. Sensors. The gesture sensor talks on the I2C bus the DSI driver
     *     installed in step 3, so this must stay after echo_display_init().
     *     Each probe runs in its own task; a missing sensor only logs. */
    err = echo_sensors_init();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "echo_sensors started with warnings: %s", esp_err_to_name(err));
    }
    ESP_LOGI(TAG, "sensors: temperature=%s gesture=%s",
             echo_sensors_temperature_ready() ? "up" : "down",
             echo_sensors_gesture_ready() ? "up" : "down");

    /* 3f. Wake word + audio. The "Hey Charlie" engine is attached only when the
     *     trained model partition exists: echo_wakeword_init() fails hard if the
     *     engine cannot load it, so a missing model degrades to buffer-only mode
     *     instead of aborting boot. echo_audio must run after echo_display_init()
     *     because the ES8311 codec shares the display's I2C port. */
#if CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED
    if (esp_partition_find_first(ESP_PARTITION_TYPE_DATA, (esp_partition_subtype_t)0x40,
                                 "model") != NULL) {
        (void)echo_wakeword_attach_engine(&echo_wakeword_tflite_engine);
    } else {
        ESP_LOGW(TAG, "no 'model' partition: wake word runs in buffer-only mode");
    }
#endif
    echo_wakeword_config_t ww_cfg = ECHO_WAKEWORD_CONFIG_DEFAULT();
    err = echo_wakeword_init(&ww_cfg);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "wake word engine unavailable: %s", esp_err_to_name(err));
        echo_error_t ww_err = {.code = err, .component = "echo_wakeword"};
        echo_event_bus_post(ECHO_EVT_ERROR, &ww_err, sizeof(ww_err));
    }

#if CONFIG_ECHO_AUDIO_ENABLED
    err = echo_audio_init();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "audio codec unavailable: %s", esp_err_to_name(err));
        echo_error_t audio_err = {.code = err, .component = "echo_audio"};
        echo_event_bus_post(ECHO_EVT_ERROR, &audio_err, sizeof(audio_err));
    } else {
        err = echo_audio_start();
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "audio capture start failed: %s", esp_err_to_name(err));
        }
    }
    ESP_LOGI(TAG, "audio: %s", echo_audio_is_ready() ? "up" : "down");

#if CONFIG_ECHO_VOICE_ENABLED
    /* The conversation loop: microphone -> echo_wakeword -> echo_ha -> speaker. */
    err = echo_voice_init();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "voice loop idle: %s", esp_err_to_name(err));
    }
    ESP_LOGI(TAG, "voice: %s", echo_voice_ready() ? "up" : "down");
#endif
#endif /* CONFIG_ECHO_AUDIO_ENABLED */

    /* 3g. Boot status screen. A one-shot task paints a diagnostic page on the
     *     10.1" panel (RAM/PSRAM, Wi-Fi, time, sensors, panels, audio) and a
     *     welcome message on the 3.5" a few seconds after boot, then hands the
     *     screens back to the bundle renderer. It needs the panels and LVGL, so
     *     it comes last. */
#if CONFIG_ECHO_STATUS_ENABLED
    err = echo_status_init();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "boot status screen idle: %s", esp_err_to_name(err));
    } else {
        ESP_LOGI(TAG, "status: scheduled");
    }
#endif

    /* 4. Tell the rest of the system we are alive. */
    ESP_ERROR_CHECK(echo_event_bus_post_simple(ECHO_EVT_BOOT_READY));

    ESP_LOGI(TAG, "boot complete: free heap %u, PSRAM free %u",
             (unsigned)esp_get_free_heap_size(),
             (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
}
