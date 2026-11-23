/*
 * Variable store.
 *
 * Two kinds of variables live here:
 *
 *   * `core.*` — device-local. The owning component registers a getter; the
 *     service tick calls it when its ttl elapses and pushes a change to the
 *     widgets bound to that path. Nothing polls on its own.
 *   * `external.*` — resolved by Charlie. The fetch task batches the due paths
 *     into one request and stores the answers here with their ttl.
 *
 * Values are plain strings: the bundle declares a type only to decide how to
 * format a float, everything else is already text by the time it reaches LVGL.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#include "echo_display.h"
#include "echo_events.h"
#include "echo_ha.h"
#include "echo_screen_internal.h"

static const char *TAG = "es_vars";

/* Last sensor sample, kept for the `core.sensors.*` providers. */
static int32_t  s_last_temperature_milli_c;
static uint16_t s_last_humidity_permille;

/* ES_VAR_PATH_MAX / ES_VAR_VALUE_MAX come from echo_screen_internal.h. */

typedef struct {
    char              path[ES_VAR_PATH_MAX];
    char              value[ES_VAR_VALUE_MAX];
    bool              valid;
    bool              stale;
    uint8_t           kind; /* es_var_kind_t */
    uint8_t           type; /* es_var_type_t */
    uint32_t          ttl_ms;
    uint32_t          last_update_ms;
    echo_var_getter_t getter; /* local only */
    void             *ctx;
} es_var_t;

static es_var_t        *s_vars;
static uint16_t         s_var_count;
static SemaphoreHandle_t s_lock;

/*
 * A refresh requested from another task (an HTTP answer, a gesture) is only
 * recorded here; es_vars_tick() applies it on the UI task, under the LVGL lock.
 * This keeps every LVGL call on the UI task even when the value arrives from
 * the fetch task.
 */
static char s_pending_refresh[ES_VAR_PATH_MAX];
static bool s_pending_refresh_valid;

static void request_refresh(const char *path)
{
    if (path == NULL) {
        return;
    }
    strncpy(s_pending_refresh, path, sizeof(s_pending_refresh) - 1);
    s_pending_refresh[sizeof(s_pending_refresh) - 1] = '\0';
    s_pending_refresh_valid = true;
}

static uint32_t now_ms(void)
{
    return (uint32_t)(esp_timer_get_time() / 1000);
}

static bool ensure_lock(void)
{
    if (s_lock == NULL) {
        s_lock = xSemaphoreCreateMutex();
        if (s_lock == NULL) {
            return false;
        }
    }
    return true;
}

static es_var_t *find(const char *path)
{
    if (path == NULL) {
        return NULL;
    }
    for (uint16_t i = 0; i < s_var_count; i++) {
        if (strcmp(s_vars[i].path, path) == 0) {
            return &s_vars[i];
        }
    }
    return NULL;
}

static es_var_t *create(const char *path)
{
    if (s_var_count >= ES_MAX_VARS) {
        ESP_LOGW(TAG, "variable table full (%u), dropping %s", s_var_count, path);
        return NULL;
    }
    if (s_vars == NULL) {
        s_vars = (es_var_t *)calloc(ES_MAX_VARS, sizeof(es_var_t));
        if (s_vars == NULL) {
            return NULL;
        }
    }
    es_var_t *v = &s_vars[s_var_count++];
    memset(v, 0, sizeof(*v));
    strncpy(v->path, path, sizeof(v->path) - 1);
    v->kind = ES_VAR_LOCAL;
    v->type = ES_VAR_STRING;
    return v;
}

/* ------------------------------------------------------------ public API */

esp_err_t echo_screen_var_register(const char *path, echo_var_getter_t getter, void *ctx)
{
    if (path == NULL || getter == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!ensure_lock()) {
        return ESP_ERR_NO_MEM;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);

    es_var_t *v = find(path);
    if (v == NULL) {
        v = create(path);
    }
    if (v != NULL) {
        v->getter = getter;
        v->ctx = ctx;
        v->kind = ES_VAR_LOCAL;
    }
    xSemaphoreGive(s_lock);
    return v != NULL ? ESP_OK : ESP_ERR_NO_MEM;
}

esp_err_t echo_screen_var_unregister(const char *path)
{
    if (path == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!ensure_lock()) {
        return ESP_ERR_NO_MEM;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    es_var_t *v = find(path);
    if (v != NULL) {
        v->getter = NULL;
        v->ctx = NULL;
    }
    xSemaphoreGive(s_lock);
    return v != NULL ? ESP_OK : ESP_ERR_NOT_FOUND;
}

esp_err_t echo_screen_var_set(const char *path, const char *value)
{
    if (path == NULL || value == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!ensure_lock()) {
        return ESP_ERR_NO_MEM;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    es_var_t *v = find(path);
    if (v == NULL) {
        v = create(path);
    }
    bool changed = false;
    if (v != NULL) {
        changed = !v->valid || strcmp(v->value, value) != 0;
        strncpy(v->value, value, sizeof(v->value) - 1);
        v->value[sizeof(v->value) - 1] = '\0';
        v->valid = true;
        v->stale = false;
        v->last_update_ms = now_ms();
    }
    xSemaphoreGive(s_lock);

    if (changed) {
        /* Applied by es_vars_tick() on the UI task, never here. */
        request_refresh(path);
    }
    return v != NULL ? ESP_OK : ESP_ERR_NO_MEM;
}

void es_vars_set_remote(const char *path, const char *value, bool stale)
{
    if (path == NULL || value == NULL) {
        return;
    }
    if (!ensure_lock()) {
        return;
    }
    bool changed = false;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    es_var_t *v = find(path);
    if (v == NULL) {
        v = create(path);
    }
    if (v != NULL) {
        v->kind = ES_VAR_REMOTE;
        changed = !v->valid || v->stale != stale || strcmp(v->value, value) != 0;
        strncpy(v->value, value, sizeof(v->value) - 1);
        v->value[sizeof(v->value) - 1] = '\0';
        v->valid = true;
        v->stale = stale;
        v->last_update_ms = now_ms();
    }
    xSemaphoreGive(s_lock);

    if (changed) {
        request_refresh(path);
    }
}

size_t es_vars_due_remote(const char **paths, size_t max)
{
    if (paths == NULL || max == 0 || !ensure_lock()) {
        return 0;
    }
    size_t   count = 0;
    uint32_t now = now_ms();
    xSemaphoreTake(s_lock, portMAX_DELAY);
    for (uint16_t i = 0; i < s_var_count && count < max; i++) {
        es_var_t *v = &s_vars[i];
        if (v->kind != ES_VAR_REMOTE) {
            continue;
        }
        /* ttl 0 means "ask once, keep the answer". */
        if (v->valid && v->ttl_ms > 0 && (now - v->last_update_ms) < v->ttl_ms) {
            continue;
        }
        paths[count++] = v->path;
    }
    xSemaphoreGive(s_lock);
    return count;
}

const char *echo_screen_var_get(const char *path)
{
    static char     s_scratch[ES_VAR_VALUE_MAX];
    if (path == NULL) {
        return NULL;
    }
    if (!ensure_lock()) {
        return NULL;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    es_var_t *v = find(path);
    const char *out = NULL;
    if (v != NULL && v->valid) {
        strncpy(s_scratch, v->value, sizeof(s_scratch) - 1);
        s_scratch[sizeof(s_scratch) - 1] = '\0';
        out = s_scratch;
    }
    xSemaphoreGive(s_lock);
    return out;
}

void es_vars_format(const char *path, uint8_t type, uint8_t precision, char *out, size_t size)
{
    const char *raw = echo_screen_var_get(path);
    if (out == NULL || size == 0) {
        return;
    }
    if (raw == NULL) {
        out[0] = '\0';
        return;
    }
    if (type == ES_VAR_FLOAT && precision > 0 && precision <= 4) {
        snprintf(out, size, "%.*f", precision, strtod(raw, NULL));
    } else {
        strncpy(out, raw, size - 1);
        out[size - 1] = '\0';
    }
}

/* --------------------------------------------------------------- the tick */

/*
 * Called from the UI service hook on every iteration. For each local variable
 * whose ttl has elapsed, call its getter and push the value if it changed. The
 * comparison happens under the lock so a getter that blocks cannot hold up the
 * rest of the store; the refresh itself runs after the lock is released.
 */
void es_vars_tick(void)
{
    if (!ensure_lock()) {
        return;
    }

    struct {
        char     path[ES_VAR_PATH_MAX];
        char     value[ES_VAR_VALUE_MAX];
        bool     changed;
    } updates[ES_MAX_VARS];
    uint16_t update_count = 0;
    uint32_t now = now_ms();

    xSemaphoreTake(s_lock, portMAX_DELAY);
    for (uint16_t i = 0; i < s_var_count; i++) {
        es_var_t *v = &s_vars[i];
        if (v->getter == NULL) {
            continue;
        }
        /* ttl 0 means "refresh on every tick" (time, for instance). */
        if (v->valid && v->ttl_ms > 0 && (now - v->last_update_ms) < v->ttl_ms) {
            continue;
        }
        char tmp[ES_VAR_VALUE_MAX];
        tmp[0] = '\0';
        if (v->getter(tmp, sizeof(tmp), v->ctx) != ESP_OK) {
            continue;
        }
        bool changed = !v->valid || strcmp(v->value, tmp) != 0;
        strncpy(v->value, tmp, sizeof(v->value) - 1);
        v->value[sizeof(v->value) - 1] = '\0';
        v->valid = true;
        v->stale = false;
        v->last_update_ms = now;
        if (changed && update_count < ES_MAX_VARS) {
            strncpy(updates[update_count].path, v->path, sizeof(updates[0].path) - 1);
            updates[update_count].path[sizeof(updates[0].path) - 1] = '\0';
            strncpy(updates[update_count].value, v->value, sizeof(updates[0].value) - 1);
            updates[update_count].value[sizeof(updates[0].value) - 1] = '\0';
            updates[update_count].changed = true;
            update_count++;
        }
    }
    xSemaphoreGive(s_lock);

    for (uint16_t i = 0; i < update_count; i++) {
        es_render_refresh_var(updates[i].path);
    }

    /* A value pushed from another task: refresh its binding now that we are on
     * the UI task. */
    if (s_pending_refresh_valid) {
        s_pending_refresh_valid = false;
        es_render_refresh_var(s_pending_refresh);
    }
}

/* Mark every remote variable stale (connectivity lost) or fresh. */
void es_vars_mark_remote_stale(bool stale)
{
    if (!ensure_lock()) {
        return;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    for (uint16_t i = 0; i < s_var_count; i++) {
        if (s_vars[i].kind == ES_VAR_REMOTE) {
            s_vars[i].stale = stale;
        }
    }
    xSemaphoreGive(s_lock);
}

/* ------------------------------------------------------- built-in providers */

static esp_err_t get_time_hhmm(char *out, size_t size, void *ctx)
{
    (void)ctx;
    time_t    now = time(NULL);
    struct tm tm_now;
    localtime_r(&now, &tm_now);
    snprintf(out, size, "%02d:%02d", tm_now.tm_hour, tm_now.tm_min);
    return ESP_OK;
}

static esp_err_t get_time_hhmmss(char *out, size_t size, void *ctx)
{
    (void)ctx;
    time_t    now = time(NULL);
    struct tm tm_now;
    localtime_r(&now, &tm_now);
    snprintf(out, size, "%02d:%02d:%02d", tm_now.tm_hour, tm_now.tm_min, tm_now.tm_sec);
    return ESP_OK;
}

static esp_err_t get_net_online(char *out, size_t size, void *ctx)
{
    (void)ctx;
    snprintf(out, size, "%s", echo_ha_is_connected() ? "1" : "0");
    return ESP_OK;
}

static esp_err_t get_temperature(char *out, size_t size, void *ctx)
{
    (void)ctx;
    snprintf(out, size, "%.1f", (double)s_last_temperature_milli_c / 1000.0);
    return ESP_OK;
}

static esp_err_t get_humidity(char *out, size_t size, void *ctx)
{
    (void)ctx;
    snprintf(out, size, "%.1f", (double)s_last_humidity_permille / 1000.0);
    return ESP_OK;
}

static esp_err_t get_display_main(char *out, size_t size, void *ctx)
{
    (void)ctx;
    snprintf(out, size, "%dx%d", ECHO_DISPLAY_MAIN_H_RES, ECHO_DISPLAY_MAIN_V_RES);
    return ESP_OK;
}

static esp_err_t get_display_aux(char *out, size_t size, void *ctx)
{
    (void)ctx;
    snprintf(out, size, "%dx%d", ECHO_DISPLAY_AUX_H_RES, ECHO_DISPLAY_AUX_V_RES);
    return ESP_OK;
}

static void temperature_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    (void)base;
    (void)id;
    const echo_temperature_t *t = (const echo_temperature_t *)data;
    if (t != NULL) {
        s_last_temperature_milli_c = t->milli_celsius;
        s_last_humidity_permille = t->humidity_permille;
    }
}

void es_vars_declare(const char *path, uint8_t kind, uint8_t type, uint32_t ttl_ms)
{
    if (path == NULL || !ensure_lock()) {
        return;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    es_var_t *v = find(path);
    if (v == NULL) {
        v = create(path);
    }
    if (v != NULL) {
        v->kind = kind;
        v->type = type;
        v->ttl_ms = ttl_ms;
        /* A declared local variable without a getter stays valid-but-empty so
         * a binding renders its placeholder instead of a stale value. */
    }
    xSemaphoreGive(s_lock);
}

void es_vars_register_builtins(void)
{
    echo_screen_var_register("core.time.hhmm", get_time_hhmm, NULL);
    echo_screen_var_register("core.time.hhmmss", get_time_hhmmss, NULL);
    echo_screen_var_register("core.net.online", get_net_online, NULL);
    echo_screen_var_register("core.sensors.temperature", get_temperature, NULL);
    echo_screen_var_register("core.sensors.humidity", get_humidity, NULL);
    echo_screen_var_register("core.display.main", get_display_main, NULL);
    echo_screen_var_register("core.display.aux", get_display_aux, NULL);

    echo_event_bus_subscribe(ECHO_EVT_TEMPERATURE, temperature_handler, NULL);
}
