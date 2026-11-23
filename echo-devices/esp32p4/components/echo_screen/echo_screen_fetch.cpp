/*
 * Bundle fetch task.
 *
 * One task owns every HTTP exchange with Charlie. It polls the tiny revision
 * document, downloads the bundle when the revision changed, batches the
 * `external.*` variables that are due and forwards `call` actions. Nothing is
 * pushed to the device: the panels only change when the device asks.
 *
 * The task never touches LVGL. Parsed bundles are handed to the UI task with
 * es_bundle_install(); variable values go through es_vars_set_remote().
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sdkconfig.h"

#include "cJSON.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "echo_ha.h"
#include "echo_screen_internal.h"
#include "echo_storage.h"

static const char *TAG = "es_fetch";

#define ES_HTTP_BODY_MAX   (192 * 1024)
#define ES_ACTION_QUEUE    4
#define ES_ACTION_NAME_MAX 64
#define ES_ACTION_PARAMS_MAX 512
#define ES_REQUEST_MAX     16

typedef struct {
    char action[ES_ACTION_NAME_MAX];
    char params[ES_ACTION_PARAMS_MAX];
} action_post_t;

typedef struct {
    char  *body;
    size_t len;
    size_t cap;
    char   etag[80];
    int    status;
} http_ctx_t;

static TaskHandle_t      s_task;
static SemaphoreHandle_t s_wake;
static QueueHandle_t     s_actions;
static SemaphoreHandle_t s_requests_lock;
static char              s_requests[ES_REQUEST_MAX][ES_VAR_PATH_MAX];
static size_t            s_request_count;
static bool              s_running;

/* --------------------------------------------------------------- HTTP layer */

static esp_err_t http_event(esp_http_client_event_t *evt)
{
    http_ctx_t *ctx = (http_ctx_t *)evt->user_data;
    if (ctx == NULL) {
        return ESP_OK;
    }
    switch (evt->event_id) {
    case HTTP_EVENT_ON_HEADER:
        if (evt->header_key != NULL && evt->header_value != NULL &&
            strcasecmp(evt->header_key, "ETag") == 0) {
            strncpy(ctx->etag, evt->header_value, sizeof(ctx->etag) - 1);
        }
        break;
    case HTTP_EVENT_ON_DATA:
        if (evt->data_len > 0) {
            size_t need = ctx->len + (size_t)evt->data_len + 1;
            if (need > ctx->cap) {
                size_t ncap = ctx->cap ? ctx->cap * 2 : 8192;
                while (ncap < need) {
                    ncap *= 2;
                }
                if (ncap > ES_HTTP_BODY_MAX) {
                    ncap = ES_HTTP_BODY_MAX;
                }
                if (ncap < need) {
                    ESP_LOGW(TAG, "response exceeds %d bytes, truncated", ES_HTTP_BODY_MAX);
                    return ESP_FAIL;
                }
                char *nb = (char *)realloc(ctx->body, ncap);
                if (nb == NULL) {
                    return ESP_FAIL;
                }
                ctx->body = nb;
                ctx->cap = ncap;
            }
            memcpy(ctx->body + ctx->len, evt->data, (size_t)evt->data_len);
            ctx->len += (size_t)evt->data_len;
            ctx->body[ctx->len] = '\0';
        }
        break;
    case HTTP_EVENT_ON_FINISH:
        if (evt->client != NULL) {
            ctx->status = esp_http_client_get_status_code(evt->client);
        }
        break;
    default:
        break;
    }
    return ESP_OK;
}

/** Dashed device id used in the Charlie routes (`aa-bb-cc-dd-ee-ff`). */
static void device_id(char *out, size_t size)
{
    const char *mac = echo_ha_mac();
    size_t      j = 0;
    for (size_t i = 0; mac != NULL && mac[i] != '\0' && j + 1 < size; i++) {
        out[j++] = mac[i] == ':' ? '-' : mac[i];
    }
    out[j] = '\0';
}

static esp_err_t http_perform(esp_http_client_method_t method, const char *path,
                              const char *post_body, http_ctx_t *ctx)
{
    char     ip[64] = {0};
    uint16_t port = 0;
    if (echo_ha_get_server(ip, sizeof(ip), &port) != ESP_OK || ip[0] == '\0') {
        return ESP_ERR_INVALID_STATE;
    }

    char url[224];
    snprintf(url, sizeof(url), "http://%s:%u%s", ip,
             (unsigned)CONFIG_ECHO_SCREEN_HTTP_PORT, path);

    esp_http_client_config_t cfg = {
        .url = url,
        .method = method,
        .timeout_ms = 12000,
        .disable_auto_redirect = false,
        .event_handler = http_event,
        .buffer_size = 2048,
        .buffer_size_tx = 2048,
        .user_data = ctx,
    };

    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (client == NULL) {
        return ESP_FAIL;
    }

    const char *mac = echo_ha_mac();
    if (mac != NULL && mac[0] != '\0') {
        esp_http_client_set_header(client, "X-Echo-Mac", mac);
    }
    if (post_body != NULL) {
        esp_http_client_set_header(client, "Content-Type", "application/json");
        esp_http_client_set_post_field(client, post_body, (int)strlen(post_body));
    }

    esp_err_t err = esp_http_client_perform(client);
    if (ctx->status == 0) {
        ctx->status = esp_http_client_get_status_code(client);
    }
    esp_http_client_cleanup(client);
    return err;
}

/* ------------------------------------------------------------------- cache */

static void save_cache(const char *json, size_t len)
{
    const char *path = CONFIG_ECHO_SCREEN_BUNDLE_PATH;
    char        prev[96];
    snprintf(prev, sizeof(prev), "%s.prev", path);

    /* Keep the outgoing revision so a failed update never leaves the device
     * without a UI. */
    if (echo_storage_exists(path)) {
        char *old = echo_storage_read_text(path);
        if (old != NULL) {
            echo_storage_write_file(prev, old, strlen(old));
            free(old);
        }
    }
    if (echo_storage_write_file(path, json, len) != ESP_OK) {
        ESP_LOGW(TAG, "could not cache bundle at %s", path);
    }
}

/* ---------------------------------------------------------------- revision */

static void download_bundle(void);

static void poll_revision(void)
{
    char id[32];
    device_id(id, sizeof(id));

    char path[96];
    snprintf(path, sizeof(path), "/echo/%s/ui/rev", id);

    http_ctx_t ctx = {0};
    esp_err_t  err = http_perform(HTTP_METHOD_GET, path, NULL, &ctx);
    if (err != ESP_OK || ctx.status != 200 || ctx.body == NULL) {
        if (err != ESP_OK) {
            ESP_LOGD(TAG, "rev poll failed: %s", esp_err_to_name(err));
        }
        free(ctx.body);
        return;
    }

    cJSON *root = cJSON_Parse(ctx.body);
    free(ctx.body);
    if (root == NULL) {
        return;
    }
    const cJSON *rev = cJSON_GetObjectItemCaseSensitive(root, "rev");
    uint32_t     new_rev = cJSON_IsNumber(rev) ? (uint32_t)rev->valuedouble : 0;
    cJSON_Delete(root);

    if (new_rev == 0) {
        return; /* nothing published yet */
    }
    if (new_rev == echo_screen_rev()) {
        return; /* already rendering this revision */
    }
    ESP_LOGI(TAG, "revision %u -> %u, downloading", (unsigned)echo_screen_rev(),
             (unsigned)new_rev);
    download_bundle();
}

static void download_bundle(void)
{
    char id[32];
    device_id(id, sizeof(id));

    char path[96];
    snprintf(path, sizeof(path), "/echo/%s/ui", id);

    http_ctx_t ctx = {0};
    esp_err_t  err = http_perform(HTTP_METHOD_GET, path, NULL, &ctx);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "bundle download failed: %s", esp_err_to_name(err));
        free(ctx.body);
        return;
    }
    if (ctx.status == 304) {
        free(ctx.body);
        return;
    }
    if (ctx.status != 200 || ctx.body == NULL) {
        ESP_LOGW(TAG, "bundle download: HTTP %d", ctx.status);
        free(ctx.body);
        return;
    }

    es_bundle_t *bundle = es_bundle_parse(ctx.body, ctx.len);
    if (bundle == NULL) {
        ESP_LOGE(TAG, "bundle rejected by the parser");
        free(ctx.body);
        return;
    }

    save_cache(ctx.body, ctx.len);
    free(ctx.body);

    uint32_t rev = bundle->rev;
    if (es_bundle_install(bundle) != ESP_OK) {
        es_bundle_free(bundle);
        return;
    }
    ESP_LOGI(TAG, "bundle rev %u installed", (unsigned)rev);
}

/* -------------------------------------------------------------- variables */

/* Collect the paths to ask for: the explicit requests first, then whatever the
 * ttl says is due. */
static size_t collect_var_paths(const char **paths, size_t max)
{
    size_t count = 0;

    if (s_requests_lock != NULL && xSemaphoreTake(s_requests_lock, 0) == pdTRUE) {
        for (size_t i = 0; i < s_request_count && count < max; i++) {
            paths[count++] = s_requests[i];
        }
        s_request_count = 0;
        xSemaphoreGive(s_requests_lock);
    }

    if (count < max) {
        count += es_vars_due_remote(paths + count, max - count);
    }
    return count;
}

static void refresh_remote_vars(void)
{
    const char *paths[ES_MAX_VARS];
    size_t      count = collect_var_paths(paths, ES_MAX_VARS);
    if (count == 0) {
        return;
    }

    char id[32];
    device_id(id, sizeof(id));

    char query[1200];
    size_t off = (size_t)snprintf(query, sizeof(query), "/echo/%s/ui/vars?", id);
    for (size_t i = 0; i < count && off + 1 < sizeof(query); i++) {
        off += (size_t)snprintf(query + off, sizeof(query) - off, "p=%s&",
                                paths[i] != NULL ? paths[i] : "");
    }

    http_ctx_t ctx = {0};
    esp_err_t  err = http_perform(HTTP_METHOD_GET, query, NULL, &ctx);
    if (err != ESP_OK || ctx.status != 200 || ctx.body == NULL) {
        es_vars_mark_remote_stale(true);
        free(ctx.body);
        return;
    }

    cJSON *root = cJSON_Parse(ctx.body);
    free(ctx.body);
    if (root == NULL) {
        return;
    }

    const cJSON *values = cJSON_GetObjectItemCaseSensitive(root, "values");
    if (cJSON_IsObject(values)) {
        const cJSON *item = NULL;
        cJSON_ArrayForEach(item, values) {
            if (item->string == NULL) {
                continue;
            }
            if (cJSON_IsString(item)) {
                es_vars_set_remote(item->string, item->valuestring, false);
            } else if (cJSON_IsNumber(item)) {
                char buf[32];
                snprintf(buf, sizeof(buf), "%g", item->valuedouble);
                es_vars_set_remote(item->string, buf, false);
            } else if (cJSON_IsBool(item)) {
                es_vars_set_remote(item->string, cJSON_IsTrue(item) ? "true" : "false", false);
            }
        }
    }

    /* Paths the server could not resolve are dimmed until the next answer. */
    const cJSON *missing = cJSON_GetObjectItemCaseSensitive(root, "missing");
    if (cJSON_IsArray(missing)) {
        const cJSON *item = NULL;
        cJSON_ArrayForEach(item, missing) {
            if (cJSON_IsString(item)) {
                es_vars_set_remote(item->valuestring, "", true);
            }
        }
    }

    cJSON_Delete(root);
}

/* ---------------------------------------------------------------- actions */

static void drain_action_posts(void)
{
    if (s_actions == NULL) {
        return;
    }
    action_post_t item;
    while (xQueueReceive(s_actions, &item, 0) == pdTRUE) {
        char id[32];
        device_id(id, sizeof(id));

        char path[96];
        snprintf(path, sizeof(path), "/echo/%s/ui/actions", id);

        char body[ES_ACTION_NAME_MAX + ES_ACTION_PARAMS_MAX + 48];
        if (item.params[0] != '\0') {
            snprintf(body, sizeof(body), "{\"action\":\"%s\",\"params\":%s}", item.action,
                     item.params);
        } else {
            snprintf(body, sizeof(body), "{\"action\":\"%s\"}", item.action);
        }

        http_ctx_t ctx = {0};
        esp_err_t  err = http_perform(HTTP_METHOD_POST, path, body, &ctx);
        if (err != ESP_OK || ctx.status < 200 || ctx.status >= 300) {
            ESP_LOGW(TAG, "action \"%s\" not delivered (HTTP %d)", item.action, ctx.status);
        }
        free(ctx.body);
    }
}

/* ------------------------------------------------------------------- task */

static void fetch_task(void *arg)
{
    (void)arg;
    bool first = true;

    while (true) {
        drain_action_posts();

        if (echo_ha_is_connected()) {
            if (first) {
                first = false;
                es_vars_mark_remote_stale(false);
            }
            poll_revision();
            refresh_remote_vars();
        } else {
            /* Offline: dim the server-owned values instead of showing stale
             * data as if it were live. */
            es_vars_mark_remote_stale(true);
        }

        uint32_t wait_ms = (uint32_t)CONFIG_ECHO_SCREEN_POLL_INTERVAL_S * 1000u;
        if (wait_ms < 1000u) {
            wait_ms = 1000u;
        }
        xSemaphoreTake(s_wake, pdMS_TO_TICKS(wait_ms));
    }
}

/* -------------------------------------------------------------------- API */

esp_err_t es_fetch_start(void)
{
    if (s_running) {
        return ESP_OK;
    }
    if (s_wake == NULL) {
        s_wake = xSemaphoreCreateBinary();
    }
    if (s_actions == NULL) {
        s_actions = xQueueCreate(ES_ACTION_QUEUE, sizeof(action_post_t));
    }
    if (s_requests_lock == NULL) {
        s_requests_lock = xSemaphoreCreateMutex();
    }
    if (s_wake == NULL || s_actions == NULL || s_requests_lock == NULL) {
        return ESP_ERR_NO_MEM;
    }

    if (xTaskCreate(fetch_task, "echo_fetch", 8192, NULL, 4, &s_task) != pdPASS) {
        s_task = NULL;
        return ESP_ERR_NO_MEM;
    }
    s_running = true;
    return ESP_OK;
}

void es_fetch_wake(void)
{
    if (s_wake != NULL) {
        xSemaphoreGive(s_wake);
    }
}

void es_fetch_post_action(const char *action, const cJSON *params)
{
    if (action == NULL || s_actions == NULL) {
        return;
    }
    action_post_t item = {0};
    strncpy(item.action, action, sizeof(item.action) - 1);

    if (params != NULL) {
        char *json = cJSON_PrintUnformatted(params);
        if (json != NULL) {
            strncpy(item.params, json, sizeof(item.params) - 1);
            cJSON_free(json);
        }
    }

    if (xQueueSend(s_actions, &item, 0) != pdTRUE) {
        ESP_LOGW(TAG, "action queue full, \"%s\" dropped", action);
        return;
    }
    es_fetch_wake();
}

void es_fetch_request_vars(const char *const *paths, size_t count)
{
    if (paths == NULL || count == 0 || s_requests_lock == NULL) {
        return;
    }
    if (xSemaphoreTake(s_requests_lock, pdMS_TO_TICKS(100)) != pdTRUE) {
        return;
    }
    for (size_t i = 0; i < count && s_request_count < ES_REQUEST_MAX; i++) {
        if (paths[i] == NULL) {
            continue;
        }
        strncpy(s_requests[s_request_count], paths[i], ES_VAR_PATH_MAX - 1);
        s_requests[s_request_count][ES_VAR_PATH_MAX - 1] = '\0';
        s_request_count++;
    }
    xSemaphoreGive(s_requests_lock);
    es_fetch_wake();
}
