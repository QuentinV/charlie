/*
 * Echo-Cook Charlie-server client.
 *
 * Responsibilities, in order of importance:
 *   1. keep a WebSocket to ws://<server>:9303/ws/echo and report the link state
 *      on the event bus (ECHO_EVT_HA_STATUS),
 *   2. answer the handshake the server needs to target this device
 *      (`{"c":"versions", ...}` with the MAC), on connect and on demand,
 *   3. translate server commands into events and audio callbacks,
 *   4. upload utterances ("start" / PCM frames / "end") when the app asks.
 *
 * Everything network-facing happens on the esp_websocket_client task. Because an
 * event handler must not block, TTS end-of-turn is detected with an esp_timer
 * (the server sends no explicit end marker) and server changes are applied from a
 * short-lived helper task.
 */
#include "echo_ha.h"

#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_timer.h"
#include "esp_websocket_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs.h"
#include "sdkconfig.h"

#include "echo_events.h"
#include "echo_ha_protocol.h"

static const char *TAG = "echo_ha";

namespace {

constexpr const char *kNvsNamespace = "echo_ha";
constexpr const char *kNvsKeyServerIp = "serverIp";
constexpr const char *kNvsKeyAccuracy = "wordAcc";

/** WebSocket task parameters. The JSON work is shallow, 4 KB of stack is plenty. */
constexpr int kTaskStack = 4608;
constexpr int kTaskPrio = 5;
constexpr int kBufferSize = 2048;
constexpr int kReconnectTimeoutMs = 5000;
constexpr int kNetworkTimeoutMs = 5000;

/** Longest JSON control message we reassemble from frames. */
constexpr size_t kMaxTextMessage = 1024;

esp_websocket_client_handle_t s_client = nullptr;
bool                          s_inited = false;
bool                          s_running = false;
volatile bool                 s_connected = false;
char                          s_server_ip[64] = CONFIG_ECHO_HA_SERVER_IP;
uint16_t                      s_server_port = CONFIG_ECHO_HA_PORT;
char                          s_mac[18] = "00:00:00:00:00:00";
uint16_t                      s_accuracy_permille = CONFIG_ECHO_HA_WAKE_ACCURACY_PERMILLE;
echo_ha_callbacks_t           s_callbacks = {};
esp_timer_handle_t            s_tts_timer = nullptr;
volatile bool                 s_tts_active = false;
volatile bool                 s_follow_up = false;
char                          s_rx_text[kMaxTextMessage];
size_t                        s_rx_used = 0;

void post_status(bool connected)
{
    echo_ha_status_t status = {};
    status.connected = connected;
    esp_err_t err = echo_event_bus_post(ECHO_EVT_HA_STATUS, &status, sizeof(status));
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "could not publish HA status: %s", esp_err_to_name(err));
    }
}

void post_error(esp_err_t code, const char *component)
{
    echo_error_t evt = {};
    evt.code = code;
    evt.component = component;
    echo_event_bus_post(ECHO_EVT_ERROR, &evt, sizeof(evt));
}

/* ---- NVS ---------------------------------------------------------------- */

esp_err_t nvs_store(const char *key, const char *value)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(kNvsNamespace, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        return err;
    }
    err = nvs_set_str(handle, key, value);
    if (err == ESP_OK) {
        err = nvs_commit(handle);
    }
    nvs_close(handle);
    return err;
}

esp_err_t nvs_load(const char *key, char *buf, size_t size)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(kNvsNamespace, NVS_READONLY, &handle);
    if (err != ESP_OK) {
        return err;
    }
    err = nvs_get_str(handle, key, buf, &size);
    nvs_close(handle);
    return err;
}

void load_mac(void)
{
    uint8_t mac[6] = {};
    if (esp_read_mac(mac, ESP_MAC_WIFI_STA) != ESP_OK) {
        ESP_LOGW(TAG, "esp_read_mac failed, reporting a zero MAC");
        return;
    }
    snprintf(s_mac, sizeof(s_mac), "%02x:%02x:%02x:%02x:%02x:%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

/* ---- outbound ----------------------------------------------------------- */

esp_err_t send_text(const char *text, size_t len)
{
    if (s_client == nullptr || !s_connected) {
        return ESP_ERR_INVALID_STATE;
    }
    int sent = esp_websocket_client_send_text(s_client, text, (int)len,
                                              pdMS_TO_TICKS(kNetworkTimeoutMs));
    return sent < 0 ? ESP_FAIL : ESP_OK;
}

esp_err_t send_bin(const void *data, size_t len)
{
    if (s_client == nullptr || !s_connected) {
        return ESP_ERR_INVALID_STATE;
    }
    int sent = esp_websocket_client_send_bin(s_client, static_cast<const char *>(data),
                                             (int)len, pdMS_TO_TICKS(kNetworkTimeoutMs));
    return sent < 0 ? ESP_FAIL : ESP_OK;
}

/* --------------------------------------------------------------------------
 * End of turn
 *
 * The server sends no "playback finished" marker: the reply is a burst of binary
 * frames followed by silence. Each chunk re-arms a one-shot timer and silence
 * closes the turn, which is what the UI (and conversation mode) reacts to.
 * -------------------------------------------------------------------------- */

constexpr uint64_t kTtsEndTimeoutUs =
    (uint64_t)CONFIG_ECHO_HA_TTS_END_TIMEOUT_MS * 1000ULL;

void tts_end(void)
{
    if (!s_tts_active) {
        return;
    }
    s_tts_active = false;
    bool follow_up = s_follow_up;
    s_follow_up = false;

    echo_ha_tts_t evt = {};
    evt.follow_up = follow_up;
    esp_err_t err = echo_event_bus_post(ECHO_EVT_HA_TTS_END, &evt, sizeof(evt));
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "could not publish TTS end: %s", esp_err_to_name(err));
    }
    ESP_LOGI(TAG, "turn finished%s", follow_up ? " (follow-up requested)" : "");
}

void tts_timer_cb(void *arg)
{
    (void)arg;
    tts_end();
}

void tts_begin_if_needed(void)
{
    if (s_tts_active) {
        return;
    }
    s_tts_active = true;
    echo_event_bus_post_simple(ECHO_EVT_HA_TTS_START);
    ESP_LOGI(TAG, "reply streaming");
}

void tts_arm_end_timer(void)
{
    if (s_tts_timer == nullptr) {
        return;
    }
    esp_timer_stop(s_tts_timer);
    esp_timer_start_once(s_tts_timer, kTtsEndTimeoutUs);
}

/* ---- inbound commands ---------------------------------------------------- */

void post_text(uint8_t screen, const char *text)
{
    echo_ha_text_t evt = {};
    evt.screen = screen;
    strlcpy(evt.text, text != nullptr ? text : "", sizeof(evt.text));
    esp_err_t err = echo_event_bus_post(ECHO_EVT_HA_TEXT, &evt, sizeof(evt));
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "could not publish text: %s", esp_err_to_name(err));
    }
}

void handle_wake_accuracy(double value)
{
    double clamped = value < 0.0 ? 0.0 : (value > 1.0 ? 1.0 : value);
    uint16_t permille = (uint16_t)(clamped * 1000.0 + 0.5);

    s_accuracy_permille = permille;
    char stored[8];
    snprintf(stored, sizeof(stored), "%u", (unsigned)permille);
    esp_err_t err = nvs_store(kNvsKeyAccuracy, stored);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "could not persist wake accuracy: %s", esp_err_to_name(err));
    }

    echo_ha_accuracy_t evt = {};
    evt.permille = permille;
    echo_event_bus_post(ECHO_EVT_HA_WAKE_ACCURACY, &evt, sizeof(evt));
    ESP_LOGI(TAG, "wake accuracy -> %u permille", (unsigned)permille);
}

void handle_set_server(const char *ip)
{
    if (ip == nullptr || ip[0] == '\0') {
        ESP_LOGW(TAG, "setServerIp without a value, ignored");
        return;
    }
    strlcpy(s_server_ip, ip, sizeof(s_server_ip));
    esp_err_t err = nvs_store(kNvsKeyServerIp, s_server_ip);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "could not persist server IP: %s", esp_err_to_name(err));
    }
    ESP_LOGI(TAG, "server moved to %s", s_server_ip);

    /* The WebSocket task cannot stop itself, so the teardown/restart runs in a
     * short-lived helper task. */
    if (xTaskCreate([](void *) {
            if (s_client != nullptr) {
                esp_websocket_client_stop(s_client);
                esp_websocket_client_destroy(s_client);
                s_client = nullptr;
            }
            s_running = false;
            s_connected = false;
            esp_err_t restart_err = echo_ha_start();
            if (restart_err != ESP_OK) {
                ESP_LOGE(TAG, "reconnect to new server failed: %s",
                         esp_err_to_name(restart_err));
            }
            vTaskDelete(nullptr);
        }, "ha_restart", 3072, nullptr, 3, nullptr) != pdPASS) {
        ESP_LOGE(TAG, "could not start the restart helper");
        post_error(ESP_ERR_NO_MEM, "echo_ha");
    }
}

void handle_command(const char *json, size_t len)
{
    cJSON *root = cJSON_ParseWithLength(json, len);
    if (root == nullptr) {
        ESP_LOGW(TAG, "ignoring malformed JSON: %.*s", (int)(len > 64 ? 64 : len), json);
        return;
    }

    cJSON *cmd = cJSON_GetObjectItemCaseSensitive(root, ECHO_HA_KEY_COMMAND);
    cJSON *value = cJSON_GetObjectItemCaseSensitive(root, ECHO_HA_KEY_VALUE);
    if (!cJSON_IsString(cmd)) {
        ESP_LOGW(TAG, "message without a \"%s\" field", ECHO_HA_KEY_COMMAND);
        cJSON_Delete(root);
        return;
    }
    const char *name = cmd->valuestring;

    if (strcmp(name, ECHO_HA_CMD_PLAY_AUDIO) == 0) {
        cJSON *conversation =
            cJSON_GetObjectItemCaseSensitive(root, ECHO_HA_KEY_CONVERSATION);
        s_follow_up = cJSON_IsTrue(conversation);
        tts_begin_if_needed();
        tts_arm_end_timer();
        if (s_callbacks.on_play_audio != nullptr) {
            s_callbacks.on_play_audio(s_follow_up, s_callbacks.ctx);
        }
    } else if (strcmp(name, ECHO_HA_CMD_WAKE_ACCURACY) == 0) {
        if (cJSON_IsNumber(value)) {
            handle_wake_accuracy(value->valuedouble);
        } else {
            ESP_LOGW(TAG, "setWakeUpWordAccuracy without a numeric \"%s\"",
                     ECHO_HA_KEY_VALUE);
        }
    } else if (strcmp(name, ECHO_HA_CMD_SET_SERVER_IP) == 0) {
        handle_set_server(cJSON_IsString(value) ? value->valuestring : nullptr);
    } else if (strcmp(name, ECHO_HA_CMD_FEEDBACK) == 0) {
        post_text(0, cJSON_IsString(value) ? value->valuestring : "");
    } else if (strcmp(name, ECHO_HA_CMD_UPDATE_DISPLAYS) == 0) {
        /* Retired: the device pulls its screen bundle over HTTP and renders it
         * locally. Old servers still send this command; acknowledge it without
         * doing anything so they do not retry. */
        ESP_LOGI(TAG, "updateDisplays ignored (device pulls its UI)");
    } else if (strcmp(name, ECHO_HA_CMD_GET_VERSIONS) == 0) {
        echo_ha_send_versions();
    } else if (strcmp(name, ECHO_HA_CMD_OTA) == 0) {
        /* OTA needs a server-hosted image and rollback-capable app partitions;
         * deferred to the next phase (docs/P0_INFRASTRUCTURE.md). Report it
         * instead of rebooting into a half-supported flow. */
        ESP_LOGW(TAG, "OTA requested but not implemented in this firmware");
        post_error(ESP_ERR_NOT_SUPPORTED, "echo_ha");
    } else {
        ESP_LOGW(TAG, "unknown command \"%s\"", name);
    }

    cJSON_Delete(root);
}

/* ---- WebSocket ----------------------------------------------------------- */

void handle_data_event(const esp_websocket_event_data_t *evt)
{
    if (evt->data_ptr == nullptr || evt->data_len <= 0) {
        return;
    }

    if (evt->op_code == ECHO_HA_OPCODE_BINARY) {
        /* TTS chunk: 16-bit PCM. Drop an odd tail so the sink always receives
         * whole samples. */
        tts_begin_if_needed();
        tts_arm_end_timer();
        if (s_callbacks.on_tts_audio != nullptr) {
            size_t len = (size_t)evt->data_len & ~(size_t)1;
            if (len > 0) {
                s_callbacks.on_tts_audio(reinterpret_cast<const uint8_t *>(evt->data_ptr),
                                         len, s_callbacks.ctx);
            }
        }
        return;
    }

    if (evt->op_code != ECHO_HA_OPCODE_TEXT &&
        evt->op_code != ECHO_HA_OPCODE_CONTINUATION) {
        return;  /* ping/pong/close are answered by the client itself */
    }

    if (evt->payload_offset == 0) {
        s_rx_used = 0;
    }
    size_t room = sizeof(s_rx_text) - 1 - s_rx_used;
    size_t copy = (size_t)evt->data_len < room ? (size_t)evt->data_len : room;
    memcpy(s_rx_text + s_rx_used, evt->data_ptr, copy);
    s_rx_used += copy;
    if (copy < (size_t)evt->data_len) {
        ESP_LOGW(TAG, "command truncated to %u bytes", (unsigned)s_rx_used);
    }

    if ((evt->payload_offset + evt->data_len) < evt->payload_len) {
        return;  /* more fragments to come */
    }
    s_rx_text[s_rx_used] = '\0';
    s_rx_used = 0;
    handle_command(s_rx_text, strlen(s_rx_text));
}

void ws_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    (void)base;
    esp_websocket_event_data_t *evt = static_cast<esp_websocket_event_data_t *>(data);

    switch (id) {
    case WEBSOCKET_EVENT_CONNECTED:
        s_connected = true;
        s_rx_used = 0;
        ESP_LOGI(TAG, "connected to ws://%s:%u%s", s_server_ip, (unsigned)s_server_port,
                 ECHO_HA_WS_PATH);
        post_status(true);
        /* Handshake: the server keys its settings and OTA targets by MAC. */
        echo_ha_send_versions();
        break;
    case WEBSOCKET_EVENT_DISCONNECTED:
    case WEBSOCKET_EVENT_CLOSED:
        if (!s_connected) {
            break;
        }
        s_connected = false;
        s_rx_used = 0;
        /* A dropped link must never leave the mic muted or a turn half-open. */
        s_tts_active = false;
        s_follow_up = false;
        if (s_tts_timer != nullptr) {
            esp_timer_stop(s_tts_timer);
        }
        ESP_LOGW(TAG, "link down (client retries every %d ms)", kReconnectTimeoutMs);
        post_status(false);
        break;
    case WEBSOCKET_EVENT_ERROR:
        ESP_LOGW(TAG, "transport error talking to %s:%u", s_server_ip,
                 (unsigned)s_server_port);
        break;
    case WEBSOCKET_EVENT_DATA:
        if (evt != nullptr) {
            handle_data_event(evt);
        }
        break;
    default:
        break;
    }
}

}  // namespace

/* --------------------------------------------------------------------------
 * Public API
 * -------------------------------------------------------------------------- */

esp_err_t echo_ha_init(void)
{
    if (s_inited) {
        return ESP_OK;
    }

    load_mac();

    /* A server address pushed by the Charlie server wins over the build-time
     * default: it survives reboots and DHCP changes. */
    char stored_ip[sizeof(s_server_ip)] = {};
    if (nvs_load(kNvsKeyServerIp, stored_ip, sizeof(stored_ip)) == ESP_OK &&
        stored_ip[0] != '\0') {
        /* Stored as "ip" or "ip:port"; split the optional port back out. */
        char *colon = strrchr(stored_ip, ':');
        if (colon != nullptr) {
            *colon = '\0';
            long parsed = strtol(colon + 1, nullptr, 10);
            if (parsed > 0 && parsed <= 65535) {
                s_server_port = (uint16_t)parsed;
            }
        }
        strlcpy(s_server_ip, stored_ip, sizeof(s_server_ip));
    }

    char stored_accuracy[8] = {};
    if (nvs_load(kNvsKeyAccuracy, stored_accuracy, sizeof(stored_accuracy)) == ESP_OK) {
        long permille = strtol(stored_accuracy, nullptr, 10);
        if (permille >= 0 && permille <= 1000) {
            s_accuracy_permille = (uint16_t)permille;
        }
    }

    const esp_timer_create_args_t timer_args = {
        .callback = &tts_timer_cb,
        .arg = nullptr,
        .dispatch_method = ESP_TIMER_TASK,
        .name = "echo_ha_tts",
        .skip_unhandled_events = true,
    };
    esp_err_t err = esp_timer_create(&timer_args, &s_tts_timer);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_timer_create: %s", esp_err_to_name(err));
        return err;
    }

    s_inited = true;
    if (s_server_ip[0] == '\0') {
        ESP_LOGW(TAG, "no Charlie server configured: set ECHO_HA_SERVER_IP "
                      "(menuconfig -> echo_ha) or send setServerIp");
    } else {
        ESP_LOGI(TAG, "server ws://%s:%u%s, device %s (mac %s)",
                 s_server_ip, (unsigned)s_server_port, ECHO_HA_WS_PATH,
                 ECHO_HA_DEVICE_TYPE, s_mac);
    }
    return ESP_OK;
}

esp_err_t echo_ha_start(void)
{
    if (s_running && s_client != nullptr) {
        return ESP_OK;
    }
    esp_err_t err = echo_ha_init();
    if (err != ESP_OK) {
        return err;
    }
    if (s_server_ip[0] == '\0') {
        ESP_LOGE(TAG, "cannot start: no server address configured");
        return ESP_ERR_INVALID_STATE;
    }

    /* Kept in static storage: the client keeps the pointer it is handed. */
    static char uri[64];
    snprintf(uri, sizeof(uri), "ws://%s:%u%s", s_server_ip, (unsigned)s_server_port,
             ECHO_HA_WS_PATH);

    esp_websocket_client_config_t cfg = {};
    cfg.uri = uri;
    cfg.task_stack = kTaskStack;
    cfg.task_prio = kTaskPrio;
    cfg.buffer_size = kBufferSize;
    cfg.reconnect_timeout_ms = kReconnectTimeoutMs;
    cfg.network_timeout_ms = kNetworkTimeoutMs;
    cfg.disable_auto_reconnect = false;

    s_client = esp_websocket_client_init(&cfg);
    if (s_client == nullptr) {
        ESP_LOGE(TAG, "esp_websocket_client_init failed for %s", uri);
        return ESP_FAIL;
    }

    err = esp_websocket_register_events(s_client, WEBSOCKET_EVENT_ANY,
                                        &ws_event_handler, nullptr);
    if (err == ESP_OK) {
        err = esp_websocket_client_start(s_client);
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "could not start the WebSocket client: %s", esp_err_to_name(err));
        esp_websocket_client_destroy(s_client);
        s_client = nullptr;
        return err;
    }

    s_running = true;
    ESP_LOGI(TAG, "connecting to %s", uri);
    return ESP_OK;
}

esp_err_t echo_ha_stop(void)
{
    if (s_client != nullptr) {
        esp_websocket_client_stop(s_client);
        esp_websocket_client_destroy(s_client);
        s_client = nullptr;
    }
    s_running = false;
    s_connected = false;
    s_tts_active = false;
    s_follow_up = false;
    s_rx_used = 0;
    return ESP_OK;
}

bool echo_ha_is_connected(void)
{
    return s_connected;
}

esp_err_t echo_ha_set_server(const char *ip, uint16_t port)
{
    if (ip == nullptr || ip[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }
    esp_err_t err = echo_ha_init();
    if (err != ESP_OK) {
        return err;
    }
    strlcpy(s_server_ip, ip, sizeof(s_server_ip));
    s_server_port = port != 0 ? port : ECHO_HA_DEFAULT_PORT;

    char combined[40];
    snprintf(combined, sizeof(combined), "%s:%u", s_server_ip, (unsigned)s_server_port);
    nvs_store(kNvsKeyServerIp, combined);

    ESP_LOGI(TAG, "server set to %s:%u", s_server_ip, (unsigned)s_server_port);

    /* Take effect immediately when the client is running. Only call this from
     * application code: stopping the client blocks until its task exits. */
    if (s_running) {
        echo_ha_stop();
        return echo_ha_start();
    }
    return ESP_OK;
}

esp_err_t echo_ha_get_server(char *ip, size_t size, uint16_t *port)
{
    if (ip == nullptr || size == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    strlcpy(ip, s_server_ip, size);
    if (port != nullptr) {
        *port = s_server_port;
    }
    return ESP_OK;
}

esp_err_t echo_ha_send_utterance_start(void)
{
    return send_text(ECHO_HA_MARK_START, sizeof(ECHO_HA_MARK_START) - 1);
}

esp_err_t echo_ha_send_utterance_audio(const void *pcm, size_t len)
{
    if (pcm == nullptr || len == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    /* The server expects 16-bit samples; a stray odd byte would shift every
     * following sample, so it is dropped instead of forwarded. */
    const uint8_t *cursor = static_cast<const uint8_t *>(pcm);
    size_t remaining = len & ~(size_t)1;

    while (remaining > 0) {
        size_t chunk = remaining > 4096 ? 4096 : remaining;
        esp_err_t err = send_bin(cursor, chunk);
        if (err != ESP_OK) {
            return err;
        }
        cursor += chunk;
        remaining -= chunk;
        /* Pacing keeps the RPC link to the C6 from being flooded when a whole
         * utterance is uploaded in one call. */
        vTaskDelay(pdMS_TO_TICKS(2));
    }
    return ESP_OK;
}

esp_err_t echo_ha_send_utterance_end(void)
{
    return send_text(ECHO_HA_MARK_END, sizeof(ECHO_HA_MARK_END) - 1);
}

esp_err_t echo_ha_send_versions(void)
{
    const esp_app_desc_t *app = esp_app_get_description();

    cJSON *root = cJSON_CreateObject();
    cJSON *value = cJSON_CreateObject();
    if (root == nullptr || value == nullptr) {
        cJSON_Delete(value);
        cJSON_Delete(root);
        return ESP_ERR_NO_MEM;
    }

    cJSON_AddStringToObject(root, ECHO_HA_KEY_COMMAND, ECHO_HA_CMD_VERSIONS);
    cJSON_AddStringToObject(value, ECHO_HA_KEY_LIB, ECHO_HA_LIBRARY_VERSION);
    cJSON_AddStringToObject(value, ECHO_HA_KEY_DEVICE,
                            app != nullptr ? app->version : "unknown");
    cJSON_AddStringToObject(value, ECHO_HA_KEY_TYPE, ECHO_HA_DEVICE_TYPE);
    cJSON_AddStringToObject(value, ECHO_HA_KEY_MAC, s_mac);
    cJSON_AddItemToObject(root, ECHO_HA_KEY_VALUE, value);

    esp_err_t err = ESP_FAIL;
    char *text = cJSON_PrintUnformatted(root);
    if (text != nullptr) {
        ESP_LOGI(TAG, "versions: %s", text);
        err = send_text(text, strlen(text));
        cJSON_free(text);
    }
    cJSON_Delete(root);
    return err;
}

void echo_ha_set_callbacks(const echo_ha_callbacks_t *callbacks)
{
    if (callbacks == nullptr) {
        memset(&s_callbacks, 0, sizeof(s_callbacks));
        return;
    }
    s_callbacks = *callbacks;
}

const char *echo_ha_mac(void)
{
    return s_mac;
}

uint16_t echo_ha_wake_accuracy_permille(void)
{
    return s_accuracy_permille;
}
