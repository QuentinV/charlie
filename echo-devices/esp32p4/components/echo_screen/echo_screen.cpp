/*
 * Screen bundle core.
 *
 * Owns the parsed bundle and the service hook that runs on the UI task. The
 * fetch task (echo_screen_fetch.cpp) parses a bundle off-task and hands it over
 * with es_bundle_install(); the swap happens here, inside the LVGL lock, so the
 * widgets are torn down before the tree they point into is freed.
 *
 * The page stack and the action interpreter live in echo_screen_actions.cpp.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sdkconfig.h"

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#include "echo_events.h"
#include "echo_screen.h"
#include "echo_screen_internal.h"
#include "echo_storage.h"
#include "echo_ui.h"

static const char *TAG = "es_core";

static SemaphoreHandle_t s_lock;
static es_bundle_t      *s_bundle;   /* rendered, owned */
static es_bundle_t      *s_pending;  /* parsed, waiting for the UI task */
static bool              s_ready;
static bool              s_from_cache;
static bool              s_hook_installed;

static bool ensure_lock(void)
{
    if (s_lock == NULL) {
        s_lock = xSemaphoreCreateMutex();
    }
    return s_lock != NULL;
}

/* ------------------------------------------------------------ module state */

es_bundle_t *es_bundle(void)
{
    return s_bundle;
}

void es_bundle_set(es_bundle_t *bundle)
{
    es_bundle_t *old = s_bundle;
    s_bundle = bundle;
    if (old != NULL && old != bundle) {
        es_bundle_free(old);
    }
}

esp_err_t es_bundle_install(es_bundle_t *bundle)
{
    if (bundle == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!ensure_lock()) {
        es_bundle_free(bundle);
        return ESP_ERR_NO_MEM;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    es_bundle_t *old = s_pending;
    s_pending = bundle;
    xSemaphoreGive(s_lock);
    if (old != NULL) {
        es_bundle_free(old);
    }
    return ESP_OK;
}

/* --------------------------------------------------------- the service hook */

/*
 * Runs on the UI task under the LVGL lock. Frees the widgets of the outgoing
 * bundle, swaps in the new tree and shows the default page of each panel.
 */
static void install_pending(void)
{
    es_bundle_t *pending = NULL;
    bool         from_cache = false;

    if (s_lock != NULL) {
        xSemaphoreTake(s_lock, portMAX_DELAY);
        pending = s_pending;
        s_pending = NULL;
        from_cache = s_from_cache;
        s_from_cache = false;
        xSemaphoreGive(s_lock);
    }
    if (pending == NULL) {
        return;
    }

    if (s_bundle != NULL) {
        for (uint16_t i = 0; i < s_bundle->page_count; i++) {
            es_render_page_free(&s_bundle->pages[i]);
        }
    }
    es_actions_reset(ECHO_SCREEN_MAIN);
    es_actions_reset(ECHO_SCREEN_AUX);

    es_bundle_set(pending);
    s_ready = true;

    for (int panel = 0; panel < 2; panel++) {
        uint8_t def = s_bundle->targets_default[panel];
        if (def != 0xFF) {
            es_actions_show((echo_screen_t)panel, def);
        }
    }

    echo_ui_bundle_t ev = {0};
    ev.rev = s_bundle->rev;
    ev.pages = s_bundle->page_count;
    ev.from_cache = from_cache;
    echo_event_bus_post(ECHO_EVT_UI_BUNDLE_LOADED, &ev, sizeof(ev));

    ESP_LOGI(TAG, "bundle rev %u live (%u pages, %s)", (unsigned)s_bundle->rev,
             (unsigned)s_bundle->page_count, from_cache ? "cache" : "http");
}

static void service_hook(void *ctx)
{
    (void)ctx;
    install_pending();
    es_actions_service();
    es_vars_tick();
}

/* --------------------------------------------------------------- gestures */

/*
 * Runs on the event loop task, so it never touches LVGL: a page-level gesture
 * binding is queued as-is, and the built-in defaults become a queued page step.
 */
static void handle_gesture(echo_screen_t panel, echo_gesture_kind_t kind)
{
    es_bundle_t *b = es_bundle();
    uint8_t      idx = es_actions_current(panel);
    if (b == NULL || idx == 0xFF) {
        return;
    }

    /* A page-level gesture binding wins over the built-in defaults. */
    es_action_t *chain = b->pages[idx].on[ES_EV_GESTURE].first;
    if (chain != NULL) {
        es_actions_post(chain, panel, b->pages[idx].id);
        return;
    }

    switch (kind) {
    case ECHO_GESTURE_SWIPE_LEFT:
    case ECHO_GESTURE_FORWARD:
        es_actions_post_step(panel, 1);
        break;
    case ECHO_GESTURE_SWIPE_RIGHT:
    case ECHO_GESTURE_BACKWARD:
        es_actions_post_step(panel, -1);
        break;
    default:
        break;
    }
}

static void gesture_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    (void)base;
    if (data == NULL) {
        return;
    }
    if (id == ECHO_EVT_GESTURE) {
        const echo_gesture_t *g = (const echo_gesture_t *)data;
        handle_gesture(g->screen, g->kind);
    } else if (id == ECHO_EVT_AIR_GESTURE) {
        const echo_air_gesture_t *g = (const echo_air_gesture_t *)data;
        handle_gesture(ECHO_SCREEN_MAIN, g->kind);
    }
}

/* --------------------------------------------------------------- cache load */

static esp_err_t load_cached_bundle(void)
{
    const char *path = CONFIG_ECHO_SCREEN_BUNDLE_PATH;
    if (!echo_storage_ready() || !echo_storage_exists(path)) {
        return ESP_ERR_NOT_FOUND;
    }
    char *text = echo_storage_read_text(path);
    if (text == NULL) {
        return ESP_ERR_NO_MEM;
    }
    size_t len = strlen(text);
    es_bundle_t *b = es_bundle_parse(text, len);
    free(text);
    if (b == NULL) {
        ESP_LOGW(TAG, "cached bundle at %s is not usable", path);
        return ESP_ERR_INVALID_STATE;
    }
    s_from_cache = true;
    return es_bundle_install(b);
}

/* -------------------------------------------------------------------- API */

static bool s_initialised;

esp_err_t echo_screen_init(void)
{
    if (s_initialised) {
        return ESP_OK;
    }
    if (!echo_ui_ready()) {
        ESP_LOGE(TAG, "echo_ui_init() must run first");
        return ESP_ERR_INVALID_STATE;
    }
    if (!ensure_lock()) {
        return ESP_ERR_NO_MEM;
    }

    es_vars_register_builtins();

    esp_err_t err = echo_ui_set_service_hook(service_hook, NULL);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "service hook refused: %s", esp_err_to_name(err));
        return err;
    }
    s_hook_installed = true;

    err = echo_event_bus_subscribe(ECHO_EVT_GESTURE, gesture_handler, NULL);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "gesture subscribe failed: %s", esp_err_to_name(err));
    }
    err = echo_event_bus_subscribe(ECHO_EVT_AIR_GESTURE, gesture_handler, NULL);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "air gesture subscribe failed: %s", esp_err_to_name(err));
    }

    /* A cached bundle paints the UI before Wi-Fi is up. */
    err = load_cached_bundle();
    if (err == ESP_ERR_NOT_FOUND) {
        ESP_LOGI(TAG, "no cached bundle: panels keep the waiting message");
    } else if (err != ESP_OK) {
        ESP_LOGW(TAG, "cached bundle not loaded: %s", esp_err_to_name(err));
    }

    err = es_fetch_start();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "fetch task failed to start: %s", esp_err_to_name(err));
        return err;
    }

    s_initialised = true;
    ESP_LOGI(TAG, "screen bundle renderer up");
    return ESP_OK;
}

bool echo_screen_ready(void)
{
    return s_ready;
}

uint32_t echo_screen_rev(void)
{
    return s_bundle != NULL ? s_bundle->rev : 0;
}

esp_err_t echo_screen_reload(void)
{
    if (!s_hook_installed) {
        return ESP_ERR_INVALID_STATE;
    }
    es_fetch_wake();
    return ESP_OK;
}
