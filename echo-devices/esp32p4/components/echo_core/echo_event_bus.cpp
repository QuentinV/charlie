/*
 * Echo-Cook event bus — thin, typed wrapper around the default ESP-IDF event loop.
 *
 * Every payload is copied into the event loop's queue by esp_event_post(), so
 * callers may pass stack variables. Keep payloads small (well under 100 bytes):
 * the default loop queue depth is 32 and its slots are heap allocated.
 */
#include "echo_events.h"

#include <string.h>

#include "esp_log.h"

static const char *TAG = "echo_events";

ESP_EVENT_DEFINE_BASE(ECHO_EVENT);

esp_err_t echo_event_bus_init(void)
{
    esp_err_t err = esp_event_loop_create_default();
    if (err == ESP_ERR_INVALID_STATE) {
        /* Someone else (Wi-Fi, esp_hosted, ...) already created it. */
        ESP_LOGI(TAG, "default event loop already running");
        return ESP_OK;
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_event_loop_create_default: %s", esp_err_to_name(err));
        return err;
    }
    ESP_LOGI(TAG, "default event loop created");
    return ESP_OK;
}

esp_err_t echo_event_bus_post(echo_event_id_t id, const void *data, size_t size)
{
    if (id < 0 || id >= ECHO_EVT_MAX) {
        return ESP_ERR_INVALID_ARG;
    }
    return esp_event_post(ECHO_EVENT, (int32_t)id, data, size, pdMS_TO_TICKS(20));
}

esp_err_t echo_event_bus_post_simple(echo_event_id_t id)
{
    return echo_event_bus_post(id, NULL, 0);
}

esp_err_t echo_event_bus_subscribe(echo_event_id_t id, esp_event_handler_t handler, void *ctx)
{
    if (handler == NULL || id < 0 || id >= ECHO_EVT_MAX) {
        return ESP_ERR_INVALID_ARG;
    }
    return esp_event_handler_register(ECHO_EVENT, (int32_t)id, handler, ctx);
}

esp_err_t echo_event_bus_subscribe_all(esp_event_handler_t handler, void *ctx)
{
    if (handler == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    return esp_event_handler_register(ECHO_EVENT, ESP_EVENT_ANY_ID, handler, ctx);
}

esp_err_t echo_event_bus_unsubscribe(echo_event_id_t id, esp_event_handler_t handler)
{
    if (handler == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    return esp_event_handler_unregister(ECHO_EVENT, (int32_t)id, handler);
}
