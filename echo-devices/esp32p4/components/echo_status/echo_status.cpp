/*
 * Boot status screen.
 *
 * One shot, no continuous ownership: after CONFIG_ECHO_STATUS_DELAY_MS the task
 * composes a status page, shows it on the 10.1" panel (and a welcome message on
 * the 3.5" panel), refreshes the values roughly once a second for
 * CONFIG_ECHO_STATUS_WINDOW_MS, then restores the screens that were visible
 * before and deletes its own widgets.
 *
 * Everything LVGL runs under echo_ui's lock, so the UI task stays the only other
 * place that touches the widget tree. The restore is guarded by the echo_screen
 * revision: if a Charlie bundle installed a page during the window, the status
 * page is already off-display and only needs deleting.
 */
#include "echo_status.h"

#include "sdkconfig.h"

#if defined(CONFIG_ECHO_STATUS_ENABLED)

#include <stdio.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"

#include "lvgl.h"

#include "echo_audio.h"
#include "echo_display.h"
#include "echo_events.h"
#include "echo_ha.h"
#include "echo_ui.h"
#include "echo_wakeword.h"

#if CONFIG_ECHO_WIFI_ENABLED
#include "echo_wifi.h"
#endif

static const char *TAG = "echo_status";

/* Fonts are generated in echo_ui (Latin-1); reuse them so accents render. */
LV_FONT_DECLARE(echo_font_16);
LV_FONT_DECLARE(echo_font_20);
LV_FONT_DECLARE(echo_font_28);

#define ST_TASK_STACK      8192
#define ST_TASK_PRIO       2
#define ST_LOCK_TIMEOUT_MS 1000

#define ST_ROWS_MAX  16
#define ST_VALUE_MAX 40

/* Palette mirrors echo_ui's dark theme. */
#define ST_COL_BG    0x0E1216
#define ST_COL_TEXT  0xF3F5F8
#define ST_COL_MUTED 0x93A0B0
#define ST_COL_OK    0x4CD07A
#define ST_COL_WARN  0xE0A93B
#define ST_COL_BAD   0xE05B5B

typedef struct {
    const char *label;
    char        value[ST_VALUE_MAX];
    uint32_t    colour;
} st_fact_t;

typedef struct {
    lv_obj_t *value;
} st_row_t;

static bool      s_ready;
static lv_obj_t *s_main_scr;
static lv_obj_t *s_aux_scr;
static lv_obj_t *s_main_prev;
static lv_obj_t *s_aux_prev;
static st_row_t  s_rows[ST_ROWS_MAX];
static int       s_row_count;

/* --------------------------------------------------------------- fact table */

static void st_set(st_fact_t *f, const char *label, const char *value, uint32_t colour)
{
    f->label = label;
    strlcpy(f->value, value, sizeof(f->value));
    f->colour = colour;
}

/* Build the label/value rows once; the same order is reused for the refresh. */
static int st_collect(st_fact_t *f, int max)
{
    int n = 0;
    char buf[ST_VALUE_MAX];

    if (n < max) { /* Uptime */
        uint32_t secs = (uint32_t)(esp_timer_get_time() / 1000000LL);
        snprintf(buf, sizeof(buf), "%uh %02um %02us",
                 (unsigned)(secs / 3600), (unsigned)((secs / 60) % 60),
                 (unsigned)(secs % 60));
        st_set(&f[n++], "Uptime", buf, ST_COL_TEXT);
    }

    if (n < max) { /* Internal RAM */
        size_t free_kb = heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024;
        size_t total_kb = heap_caps_get_total_size(MALLOC_CAP_INTERNAL) / 1024;
        size_t min_kb = heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL) / 1024;
        snprintf(buf, sizeof(buf), "%u / %u KB", (unsigned)free_kb, (unsigned)total_kb);
        st_set(&f[n++], "RAM free", buf, (free_kb < 32) ? ST_COL_WARN : ST_COL_OK);
        snprintf(buf, sizeof(buf), "%u KB", (unsigned)min_kb);
        st_set(&f[n++], "RAM low-water", buf, ST_COL_TEXT);
    }

    if (n < max) { /* PSRAM */
        size_t total_kb = heap_caps_get_total_size(MALLOC_CAP_SPIRAM) / 1024;
        if (total_kb == 0) {
            st_set(&f[n++], "PSRAM free", "absent", ST_COL_WARN);
        } else {
            size_t free_kb = heap_caps_get_free_size(MALLOC_CAP_SPIRAM) / 1024;
            snprintf(buf, sizeof(buf), "%u / %u KB", (unsigned)free_kb, (unsigned)total_kb);
            st_set(&f[n++], "PSRAM free", buf, ST_COL_OK);
        }
    }

    if (n < max) { /* Wi-Fi */
#if CONFIG_ECHO_WIFI_ENABLED
        if (echo_wifi_is_connected()) {
            char ip[16] = {};
            echo_wifi_get_ip(ip, sizeof(ip));
            snprintf(buf, sizeof(buf), "%s  %ddBm", ip, (int)echo_wifi_rssi());
            st_set(&f[n++], "Wi-Fi", buf, ST_COL_OK);
        } else if (echo_wifi_ssid()[0] == '\0') {
            st_set(&f[n++], "Wi-Fi", "not provisioned", ST_COL_WARN);
        } else {
            snprintf(buf, sizeof(buf), "joining \"%s\" (retry %ld)",
                     echo_wifi_ssid(), (long)echo_wifi_retry_count());
            st_set(&f[n++], "Wi-Fi", buf, ST_COL_WARN);
        }
#else
        st_set(&f[n++], "Wi-Fi", "disabled", ST_COL_MUTED);
#endif
    }

    if (n < max) { /* Time */
#if CONFIG_ECHO_WIFI_ENABLED
        char time_buf[16];
        if (echo_wifi_time_str(time_buf, sizeof(time_buf)) == ESP_OK) {
            st_set(&f[n++], "Time", time_buf, ST_COL_OK);
        } else {
            st_set(&f[n++], "Time", "not synced", ST_COL_WARN);
        }
#else
        st_set(&f[n++], "Time", "no Wi-Fi", ST_COL_MUTED);
#endif
    }

    if (n < max) { /* 10.1" panel + touch */
        bool main_up = echo_display_ready(ECHO_DISPLAY_MAIN);
        st_set(&f[n++], "Panel 10.1\"", main_up ? "ready" : "down",
               main_up ? ST_COL_OK : ST_COL_BAD);
        bool touch = echo_display_touch_ready();
        st_set(&f[n++], "Touch", touch ? "ready" : "down",
               touch ? ST_COL_OK : ST_COL_WARN);
    }

    if (n < max) { /* 3.5" panel */
#if CONFIG_ECHO_DISPLAY_SPI_ENABLED
        bool aux_up = echo_display_ready(ECHO_DISPLAY_AUX);
        st_set(&f[n++], "Panel 3.5\"", aux_up ? "ready" : "down",
               aux_up ? ST_COL_OK : ST_COL_BAD);
#else
        st_set(&f[n++], "Panel 3.5\"", "disabled", ST_COL_MUTED);
#endif
    }

    if (n < max) { /* Temperature */
#if CONFIG_ECHO_SENSORS_DHT22_ENABLED
        int32_t milli = 0;
        uint16_t rh = 0;
        if (echo_sensors_temperature_last(&milli, &rh)) {
            snprintf(buf, sizeof(buf), "%ld.%01ld C  %u%%",
                     (long)(milli / 1000),
                     (long)((milli % 1000 + 1000) % 1000) / 100,
                     (unsigned)(rh / 1000));
            st_set(&f[n++], "Temperature", buf, ST_COL_OK);
        } else {
            st_set(&f[n++], "Temperature",
                   echo_sensors_temperature_ready() ? "no sample" : "down", ST_COL_WARN);
        }
#else
        st_set(&f[n++], "Temperature", "disabled", ST_COL_MUTED);
#endif
    }

    if (n < max) { /* Gesture */
#if CONFIG_ECHO_SENSORS_PAJ7620_ENABLED
        bool gesture = echo_sensors_gesture_ready();
        st_set(&f[n++], "Gesture", gesture ? "ready" : "down",
               gesture ? ST_COL_OK : ST_COL_WARN);
#else
        st_set(&f[n++], "Gesture", "disabled", ST_COL_MUTED);
#endif
    }

    if (n < max) { /* Microphone + speaker */
#if CONFIG_ECHO_AUDIO_ENABLED
        bool audio = echo_audio_is_ready();
        st_set(&f[n++], "Microphone", audio ? "ready" : "down",
               audio ? ST_COL_OK : ST_COL_BAD);
        st_set(&f[n++], "Speaker", audio ? "ready" : "down",
               audio ? ST_COL_OK : ST_COL_BAD);
#else
        st_set(&f[n++], "Microphone", "disabled", ST_COL_MUTED);
        st_set(&f[n++], "Speaker", "disabled", ST_COL_MUTED);
#endif
    }

    if (n < max) { /* Wake word + Charlie */
        bool ww = echo_wakeword_is_ready();
        st_set(&f[n++], "Wake word", ww ? "ready" : "idle", ww ? ST_COL_OK : ST_COL_MUTED);
        bool ha = echo_ha_is_connected();
        st_set(&f[n++], "Charlie", ha ? "connected" : "offline",
               ha ? ST_COL_OK : ST_COL_MUTED);
    }

    return n;
}

/* --------------------------------------------------------------- LVGL build */

static void st_style_screen(lv_obj_t *scr)
{
    lv_obj_set_style_bg_color(scr, lv_color_hex(ST_COL_BG), 0);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(scr, 0, 0);
    lv_obj_set_style_pad_all(scr, 28, 0);
    lv_obj_set_style_pad_row(scr, 10, 0);
    lv_obj_set_scrollable(scr, false);
}

static lv_obj_t *st_build_main(lv_display_t *disp, const st_fact_t *facts, int count)
{
    lv_display_set_default(disp);
    lv_obj_t *scr = lv_obj_create(NULL);
    st_style_screen(scr);
    lv_obj_set_flex_flow(scr, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(scr, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);

    lv_obj_t *title = lv_label_create(scr);
    lv_label_set_text(title, "Echo-Cook status");
    lv_obj_set_style_text_font(title, &echo_font_28, 0);
    lv_obj_set_style_text_color(title, lv_color_hex(ST_COL_TEXT), 0);
    lv_obj_set_style_pad_bottom(title, 14, 0);

    s_row_count = 0;
    for (int i = 0; i < count && i < ST_ROWS_MAX; i++) {
        lv_obj_t *row = lv_obj_create(scr);
        lv_obj_set_width(row, LV_PCT(100));
        lv_obj_set_height(row, LV_SIZE_CONTENT);
        lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, 0);
        lv_obj_set_style_border_width(row, 0, 0);
        lv_obj_set_style_pad_all(row, 0, 0);
        lv_obj_set_style_pad_column(row, 8, 0);
        lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
        lv_obj_set_flex_align(row, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER,
                              LV_FLEX_ALIGN_CENTER);

        lv_obj_t *name = lv_label_create(row);
        lv_label_set_text(name, facts[i].label);
        lv_obj_set_style_text_font(name, &echo_font_16, 0);
        lv_obj_set_style_text_color(name, lv_color_hex(ST_COL_MUTED), 0);

        lv_obj_t *value = lv_label_create(row);
        lv_label_set_text(value, facts[i].value);
        lv_obj_set_style_text_font(value, &echo_font_16, 0);
        lv_obj_set_style_text_color(value, lv_color_hex(facts[i].colour), 0);

        s_rows[s_row_count++].value = value;
    }

    lv_screen_load(scr);
    return scr;
}

static lv_obj_t *st_build_aux(lv_display_t *disp)
{
    lv_display_set_default(disp);
    lv_obj_t *scr = lv_obj_create(NULL);
    st_style_screen(scr);
    lv_obj_set_flex_flow(scr, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(scr, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    lv_obj_t *title = lv_label_create(scr);
    lv_label_set_text(title, "Welcome to EchoCook");
    lv_obj_set_style_text_font(title, &echo_font_20, 0);
    lv_obj_set_style_text_color(title, lv_color_hex(ST_COL_TEXT), 0);
    lv_obj_set_width(title, LV_PCT(100));
    lv_obj_set_style_text_align(title, LV_TEXT_ALIGN_CENTER, 0);

    lv_screen_load(scr);
    return scr;
}

/* Re-read the values and push them into the existing rows (under the LVGL lock). */
static void st_apply_facts(void)
{
    st_fact_t facts[ST_ROWS_MAX];
    int count = st_collect(facts, ST_ROWS_MAX);
    for (int i = 0; i < count && i < s_row_count; i++) {
        lv_label_set_text(s_rows[i].value, facts[i].value);
        lv_obj_set_style_text_color(s_rows[i].value, lv_color_hex(facts[i].colour), 0);
    }
}

static bool st_show(void)
{
    if (!echo_ui_lock(ST_LOCK_TIMEOUT_MS)) {
        ESP_LOGW(TAG, "LVGL lock not acquired; status skipped");
        return false;
    }

    st_fact_t facts[ST_ROWS_MAX];
    int count = st_collect(facts, ST_ROWS_MAX);

    bool any = false;
    lv_display_t *disp = echo_ui_display(ECHO_SCREEN_MAIN);
    if (disp != NULL) {
        s_main_prev = lv_display_get_screen_active(disp);
        s_main_scr = st_build_main(disp, facts, count);
        any = (s_main_scr != NULL);
    }
#if CONFIG_ECHO_STATUS_SHOW_AUX
    disp = echo_ui_display(ECHO_SCREEN_AUX);
    if (disp != NULL) {
        s_aux_prev = lv_display_get_screen_active(disp);
        s_aux_scr = st_build_aux(disp);
        any = any || (s_aux_scr != NULL);
    }
#endif

    echo_ui_unlock();
    return any;
}

static void st_teardown(void)
{
    if (!echo_ui_lock(ST_LOCK_TIMEOUT_MS)) {
        return;
    }

    /* Restore a panel only when our status screen is still the active one for it.
     * A Charlie bundle may have replaced it on one panel and not the other, so
     * this stays per-panel: a replaced panel simply keeps its new page, and the
     * status widgets are then deleted either way. */
    lv_display_t *disp = echo_ui_display(ECHO_SCREEN_MAIN);
    if (s_main_scr != NULL) {
        if (disp != NULL && lv_display_get_screen_active(disp) == s_main_scr &&
            s_main_prev != NULL) {
            lv_display_set_default(disp);
            lv_screen_load(s_main_prev);
        }
        lv_obj_delete(s_main_scr);
        s_main_scr = NULL;
    }

    disp = echo_ui_display(ECHO_SCREEN_AUX);
    if (s_aux_scr != NULL) {
        if (disp != NULL && lv_display_get_screen_active(disp) == s_aux_scr &&
            s_aux_prev != NULL) {
            lv_display_set_default(disp);
            lv_screen_load(s_aux_prev);
        }
        lv_obj_delete(s_aux_scr);
        s_aux_scr = NULL;
    }

    s_row_count = 0;

    /* Leave the default display on MAIN, as echo_ui_init() does. */
    lv_display_t *main_disp = echo_ui_display(ECHO_SCREEN_MAIN);
    if (main_disp != NULL) {
        lv_display_set_default(main_disp);
    }

    echo_ui_unlock();
}

/* --------------------------------------------------------------- sound */

static void st_chime(void)
{
#if CONFIG_ECHO_STATUS_PLAY_SOUND && CONFIG_ECHO_AUDIO_ENABLED
    if (!echo_audio_is_ready()) {
        return;
    }
    (void)echo_audio_play_tone(660, 150);
    vTaskDelay(pdMS_TO_TICKS(190));
    (void)echo_audio_play_tone(990, 240);
#endif
}

/* ------------------------------------------------------------------- task */

static void st_task(void *arg)
{
    (void)arg;

    vTaskDelay(pdMS_TO_TICKS(CONFIG_ECHO_STATUS_DELAY_MS));

    if (!st_show()) {
        ESP_LOGW(TAG, "status screen not shown (no ready panel or no LVGL lock)");
        vTaskDelete(NULL);
        return;
    }
    ESP_LOGI(TAG, "boot status on screen for %d ms", CONFIG_ECHO_STATUS_WINDOW_MS);

    st_chime();

    for (uint32_t elapsed = 0; elapsed < (uint32_t)CONFIG_ECHO_STATUS_WINDOW_MS;
         elapsed += 1000) {
        vTaskDelay(pdMS_TO_TICKS(1000));
        if (echo_ui_lock(ST_LOCK_TIMEOUT_MS)) {
            st_apply_facts();
            echo_ui_unlock();
        }
    }

    st_teardown();
    ESP_LOGI(TAG, "boot status dismissed");
    vTaskDelete(NULL);
}

/* -------------------------------------------------------------------- API */

esp_err_t echo_status_init(void)
{
    if (s_ready) {
        return ESP_OK;
    }
    if (!echo_ui_ready()) {
        ESP_LOGE(TAG, "echo_ui_init() must run first");
        return ESP_ERR_INVALID_STATE;
    }
    if (xTaskCreate(st_task, "echo_status", ST_TASK_STACK, NULL, ST_TASK_PRIO, NULL) != pdPASS) {
        ESP_LOGE(TAG, "status task not created");
        return ESP_ERR_NO_MEM;
    }
    s_ready = true;
    ESP_LOGI(TAG, "boot status scheduled (+%d ms, %d ms window)",
             CONFIG_ECHO_STATUS_DELAY_MS, CONFIG_ECHO_STATUS_WINDOW_MS);
    return ESP_OK;
}

bool echo_status_ready(void)
{
    return s_ready;
}

#else /* !CONFIG_ECHO_STATUS_ENABLED */

esp_err_t echo_status_init(void) { return ESP_OK; }
bool      echo_status_ready(void) { return false; }

#endif /* CONFIG_ECHO_STATUS_ENABLED */




