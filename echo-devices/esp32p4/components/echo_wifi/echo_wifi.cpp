/*
 * Echo-Cook Wi-Fi station — hosted (esp_wifi_remote -> esp_hosted -> C6/SDIO).
 *
 * Flow:
 *   echo_wifi_init()   netif + esp_wifi_init() + handlers   (talks to the C6)
 *   echo_wifi_start()  set_mode/set_config/start            (STA_START -> connect)
 *   handler            STA_DISCONNECTED -> one-shot retry timer -> esp_wifi_connect()
 *                      IP_EVENT_STA_GOT_IP -> publish ECHO_EVT_NET_STATUS
 *
 * Event handlers run on the default event loop task, so the reconnect delay is
 * armed with esp_timer instead of vTaskDelay(). Blocking there would stall every
 * other subscriber (UI redraws, HA client) as well.
 */
#include "echo_wifi.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

#include "echo_events.h"

static const char *TAG = "echo_wifi";

namespace {

esp_netif_t       *s_netif = nullptr;
esp_timer_handle_t s_retry_timer = nullptr;
bool               s_inited = false;
bool               s_started = false;
volatile bool      s_connected = false;
volatile int32_t   s_retries = 0;
volatile int8_t    s_rssi = 0;
char               s_ip[16] = "0.0.0.0";

/** 0 means "retry forever" (Kconfig default). */
constexpr int32_t kMaxRetry = CONFIG_ECHO_WIFI_MAX_RETRY;

/** SNTP is started at most once, when the station first obtains an IP address. */
bool s_sntp_started = false;

/* Epoch below which the clock is treated as "not synced" (2020-09-13). */
constexpr time_t kTimeValidEpoch = 1600000000;

void start_sntp()
{
#if CONFIG_ECHO_WIFI_NTP_ENABLED
    if (s_sntp_started) {
        return;
    }
    /* TZ must be applied before the first localtime_r() so the UI shows local
     * time instead of UTC. */
    setenv("TZ", CONFIG_ECHO_WIFI_TZ, 1);
    tzset();

    esp_sntp_config_t cfg = ESP_NETIF_SNTP_DEFAULT_CONFIG(CONFIG_ECHO_WIFI_NTP_SERVER);
    esp_err_t err = esp_netif_sntp_init(&cfg);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "SNTP init failed: %s", esp_err_to_name(err));
        return;
    }
    s_sntp_started = true;
    ESP_LOGI(TAG, "SNTP started (server \"%s\", tz \"%s\")",
             CONFIG_ECHO_WIFI_NTP_SERVER, CONFIG_ECHO_WIFI_TZ);
#endif
}

void publish_status(bool connected)
{
    echo_net_status_t status = {};
    status.connected = connected;
    status.rssi = s_rssi;
    esp_err_t err = echo_event_bus_post(ECHO_EVT_NET_STATUS, &status, sizeof(status));
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "could not publish net status: %s", esp_err_to_name(err));
    }
}

void publish_error(esp_err_t code)
{
    echo_error_t evt = {};
    evt.code = code;
    evt.component = "echo_wifi";
    echo_event_bus_post(ECHO_EVT_ERROR, &evt, sizeof(evt));
}

void refresh_rssi(void)
{
    wifi_ap_record_t ap = {};
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) {
        s_rssi = ap.rssi;
    }
}

void retry_cb(void *arg)
{
    (void)arg;
    if (!s_started || s_connected) {
        return;
    }
    ESP_LOGI(TAG, "reconnect attempt %ld", (long)(s_retries + 1));
    esp_err_t err = esp_wifi_connect();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "esp_wifi_connect: %s", esp_err_to_name(err));
    }
}

void schedule_retry(void)
{
    if (!s_started) {
        return;
    }
    if (kMaxRetry > 0 && s_retries >= kMaxRetry) {
        ESP_LOGE(TAG, "giving up after %ld attempts (menuconfig -> echo_wifi)",
                 (long)s_retries);
        publish_error(ESP_FAIL);
        return;
    }
    /* Not ++: C++20 deprecates incrementing a volatile-qualified scalar. */
    s_retries = s_retries + 1;
    if (s_retry_timer != nullptr) {
        esp_timer_stop(s_retry_timer);  /* harmless when not armed */
        esp_timer_start_once(s_retry_timer,
                             (uint64_t)CONFIG_ECHO_WIFI_RETRY_DELAY_MS * 1000ULL);
    }
}

void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;

    if (base == WIFI_EVENT) {
        switch (id) {
        case WIFI_EVENT_STA_START:
            ESP_LOGI(TAG, "station started, connecting to \"%s\"", echo_wifi_ssid());
            esp_wifi_connect();
            break;
        case WIFI_EVENT_STA_CONNECTED: {
            const wifi_event_sta_connected_t *evt =
                static_cast<const wifi_event_sta_connected_t *>(data);
            ESP_LOGI(TAG, "associated with \"%.*s\" (channel %u)",
                     evt ? (int)strnlen((const char *)evt->ssid, sizeof(evt->ssid)) : 0,
                     evt ? (const char *)evt->ssid : "",
                     evt ? (unsigned)evt->channel : 0u);
            break;
        }
        case WIFI_EVENT_STA_DISCONNECTED: {
            const wifi_event_sta_disconnected_t *evt =
                static_cast<const wifi_event_sta_disconnected_t *>(data);
            bool was_connected = s_connected;
            s_connected = false;
            strlcpy(s_ip, "0.0.0.0", sizeof(s_ip));
            ESP_LOGW(TAG, "disconnected (reason %d)%s",
                     evt ? (int)evt->reason : -1,
                     was_connected ? "" : ", still offline");
            publish_status(false);
            schedule_retry();
            break;
        }
        default:
            break;
        }
        return;
    }

    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *evt = static_cast<const ip_event_got_ip_t *>(data);
        if (evt != nullptr) {
            esp_ip4addr_ntoa(&evt->ip_info.ip, s_ip, sizeof(s_ip));
        }
        refresh_rssi();
        s_connected = true;
        s_retries = 0;
        if (s_retry_timer != nullptr) {
            esp_timer_stop(s_retry_timer);
        }
        ESP_LOGI(TAG, "got IP %s (rssi %d)", s_ip, (int)s_rssi);
        publish_status(true);
        start_sntp();
    }
}

}  // namespace

esp_err_t echo_wifi_init(void)
{
    if (s_inited) {
        return ESP_OK;
    }
    if (CONFIG_ECHO_WIFI_SSID[0] == '\0') {
        ESP_LOGE(TAG, "no SSID configured: set ECHO_WIFI_SSID "
                      "(menuconfig -> echo_wifi) or edit sdkconfig.defaults");
        return ESP_ERR_INVALID_STATE;
    }

    esp_err_t err = esp_netif_init();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "esp_netif_init: %s", esp_err_to_name(err));
        return err;
    }

    /* The default loop is shared with every other component; creating it twice
     * is not an error (echo_event_bus_init() also tolerates that). */
    err = echo_event_bus_init();
    if (err != ESP_OK) {
        return err;
    }

    s_netif = esp_netif_create_default_wifi_sta();
    if (s_netif == nullptr) {
        ESP_LOGE(TAG, "esp_netif_create_default_wifi_sta failed");
        return ESP_FAIL;
    }
    esp_netif_set_hostname(s_netif, CONFIG_ECHO_WIFI_HOSTNAME);

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    err = esp_wifi_init(&cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_wifi_init: %s - is the ESP32-C6 running the ESP-Hosted "
                      "slave firmware? (SDIO link must come up first)",
                 esp_err_to_name(err));
        esp_netif_destroy_default_wifi(s_netif);
        s_netif = nullptr;
        return err;
    }

    /* Credentials come from Kconfig, not NVS: the station is provisioned at
     * build time in this phase. */
    esp_wifi_set_storage(WIFI_STORAGE_RAM);
    /* Voice latency matters more than the small current saving of modem sleep. */
    esp_wifi_set_ps(WIFI_PS_NONE);

    err = esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, nullptr);
    if (err == ESP_OK) {
        err = esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                                         &wifi_event_handler, nullptr);
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "event handler registration: %s", esp_err_to_name(err));
        esp_wifi_deinit();
        esp_netif_destroy_default_wifi(s_netif);
        s_netif = nullptr;
        return err;
    }

    const esp_timer_create_args_t timer_args = {
        .callback = &retry_cb,
        .arg = nullptr,
        .dispatch_method = ESP_TIMER_TASK,
        .name = "echo_wifi_retry",
        .skip_unhandled_events = true,
    };
    err = esp_timer_create(&timer_args, &s_retry_timer);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_timer_create: %s", esp_err_to_name(err));
        esp_wifi_deinit();
        esp_netif_destroy_default_wifi(s_netif);
        s_netif = nullptr;
        return err;
    }

    s_inited = true;
    ESP_LOGI(TAG, "hosted station initialised (ssid \"%s\", hostname \"%s\")",
             CONFIG_ECHO_WIFI_SSID, CONFIG_ECHO_WIFI_HOSTNAME);
    return ESP_OK;
}

esp_err_t echo_wifi_start(void)
{
    if (!s_inited) {
        return ESP_ERR_INVALID_STATE;
    }
    if (s_started) {
        return ESP_OK;
    }

    wifi_config_t wifi_config = {};
    memcpy(wifi_config.sta.ssid, CONFIG_ECHO_WIFI_SSID,
           strnlen(CONFIG_ECHO_WIFI_SSID, sizeof(wifi_config.sta.ssid)));
    memcpy(wifi_config.sta.password, CONFIG_ECHO_WIFI_PASSWORD,
           strnlen(CONFIG_ECHO_WIFI_PASSWORD, sizeof(wifi_config.sta.password)));
    /* Empty password => open network, anything else => at least WPA2. */
    wifi_config.sta.threshold.authmode =
        CONFIG_ECHO_WIFI_PASSWORD[0] != '\0' ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
    wifi_config.sta.pmf_cfg.capable = true;

    esp_err_t err = esp_wifi_set_mode(WIFI_MODE_STA);
    if (err == ESP_OK) {
        err = esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
    }
    if (err == ESP_OK) {
        err = esp_wifi_start();
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "station start failed: %s", esp_err_to_name(err));
        publish_error(err);
        return err;
    }

    s_started = true;
    ESP_LOGI(TAG, "station starting");
    return ESP_OK;
}

esp_err_t echo_wifi_connect(void)
{
    esp_err_t err = echo_wifi_init();
    if (err != ESP_OK) {
        return err;
    }
    return echo_wifi_start();
}

esp_err_t echo_wifi_disconnect(void)
{
    if (!s_started) {
        return ESP_OK;
    }
    s_started = false;
    if (s_retry_timer != nullptr) {
        esp_timer_stop(s_retry_timer);
    }
    esp_err_t err = esp_wifi_disconnect();
    if (err != ESP_OK && err != ESP_ERR_WIFI_NOT_CONNECT) {
        ESP_LOGW(TAG, "esp_wifi_disconnect: %s", esp_err_to_name(err));
        return err;
    }
    return ESP_OK;
}

bool echo_wifi_is_connected(void)
{
    return s_connected;
}

bool echo_wifi_wait_connected(uint32_t timeout_ms)
{
    uint32_t waited = 0;
    while (!s_connected && waited < timeout_ms) {
        vTaskDelay(pdMS_TO_TICKS(100));
        waited += 100;
    }
    return s_connected;
}

esp_err_t echo_wifi_get_ip(char *buf, size_t size)
{
    if (buf == nullptr || size == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    strlcpy(buf, s_ip[0] != '\0' ? s_ip : "0.0.0.0", size);
    return ESP_OK;
}

esp_err_t echo_wifi_get_mac(char *buf, size_t size)
{
    if (buf == nullptr || size < 18) {
        return ESP_ERR_INVALID_ARG;
    }
    uint8_t mac[6] = {};
    esp_err_t err = esp_read_mac(mac, ESP_MAC_WIFI_STA);
    if (err != ESP_OK) {
        return err;
    }
    snprintf(buf, size, "%02x:%02x:%02x:%02x:%02x:%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return ESP_OK;
}

int8_t echo_wifi_rssi(void)
{
    return s_rssi;
}

const char *echo_wifi_ssid(void)
{
    return CONFIG_ECHO_WIFI_SSID;
}

int32_t echo_wifi_retry_count(void)
{
    return s_retries;
}

esp_err_t echo_wifi_time_start(void)
{
    start_sntp();
    return s_sntp_started ? ESP_OK : ESP_ERR_INVALID_STATE;
}

bool echo_wifi_time_synced(void)
{
    return time(nullptr) >= kTimeValidEpoch;
}

esp_err_t echo_wifi_time_str(char *buf, size_t size)
{
    if (buf == nullptr || size == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    time_t now = time(nullptr);
    if (now < kTimeValidEpoch) {
        strlcpy(buf, "--:--:--", size);
        return ESP_ERR_INVALID_STATE;
    }
    struct tm tm_now = {};
    localtime_r(&now, &tm_now);
    if (strftime(buf, size, "%H:%M:%S", &tm_now) == 0) {
        return ESP_ERR_INVALID_SIZE;
    }
    return ESP_OK;
}
