/*
 * Echo-Cook LVGL plumbing.
 *
 * This file owns the two LVGL displays, the touch indev, the UI task and the
 * "waiting for UI" fallback screen. It deliberately knows nothing about the
 * screen bundle format: echo_screen builds widgets and either runs them from the
 * service hook (inside the LVGL lock) or hands a finished screen over with
 * echo_ui_screen_load().
 *
 * The old recipe browser was removed together with the server-pushed
 * `updateDisplays` path. Until a bundle arrives from Charlie the panels show a
 * plain "Waiting for UI from Charlie" message.
 */

#include "echo_ui.h"

#include <stdio.h>
#include <string.h>

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "echo_display.h"

/* Generated from LVGL's bundled DejaVu Sans (Latin-1 + common punctuation).
 * See components/echo_ui/fonts/README.md. */
LV_FONT_DECLARE(echo_font_16);
LV_FONT_DECLARE(echo_font_20);
LV_FONT_DECLARE(echo_font_28);

static const char *TAG = "echo_ui";

/* ------------------------------------------------------------------ tuning */

#define UI_TASK_STACK      12288
#define UI_TASK_PRIO       3
#define UI_MIN_PERIOD_MS   10
#define UI_MAX_PERIOD_MS   40
#define UI_LOCK_TIMEOUT_MS 1000

/* Partial render buffers. LVGL renders in chunks, so these bound RAM use. */
#define UI_MAIN_BUF_LINES 80 /* 800 x 80 x 2 = 128000 B, PSRAM */
#define UI_AUX_BUF_LINES  40 /* 480 x 40 x 2 =  38400 B, internal */

/* Message screen copy limits (the command queue copies these). */
#define UI_MSG_TITLE_MAX 48
#define UI_MSG_BODY_MAX  192

/* Palette (RGB hex, dark UI). Matches the bundle theme defaults. */
#define UI_COL_BG    0x0E1216
#define UI_COL_TEXT  0xF3F5F8
#define UI_COL_MUTED 0x93A0B0

/* Fallback text shown until the first bundle arrives. */
#define UI_WAITING_TITLE "Echo-Cook"
#define UI_WAITING_BODY  "Waiting for UI from Charlie"

/* ------------------------------------------------------------------- state */

typedef enum {
    UI_CMD_NONE = 0,
    UI_CMD_SHOW_MESSAGE,
} ui_cmd_kind_t;

typedef struct {
    ui_cmd_kind_t kind;
    char title[UI_MSG_TITLE_MAX];
    char body[UI_MSG_BODY_MAX];
} ui_cmd_t;

static lv_display_t *s_main_disp;
static lv_display_t *s_aux_disp;

/* Message screen per panel: the root this layer owns. */
static lv_obj_t *s_main_root;
static lv_obj_t *s_aux_root;
static lv_obj_t *s_main_title;
static lv_obj_t *s_main_body;
static lv_obj_t *s_aux_title;
static lv_obj_t *s_aux_body;

static SemaphoreHandle_t s_lvgl_lock;
static QueueHandle_t s_cmd_queue;
static TaskHandle_t s_ui_task;
static bool s_ready;

static echo_ui_service_fn_t s_service_fn;
static void *s_service_ctx;

/* Bring-up: count flushes so the log proves LVGL is pushing pixels to a panel. */
static uint32_t s_flush_count;

/* ----------------------------------------------------------------- helpers */

static uint32_t ui_tick_ms(void)
{
    return (uint32_t)(esp_timer_get_time() / 1000);
}

static lv_display_t *ui_display_of(echo_screen_t screen)
{
    return (screen == ECHO_SCREEN_AUX) ? s_aux_disp : s_main_disp;
}

static lv_obj_t *ui_root_of(echo_screen_t screen)
{
    return (screen == ECHO_SCREEN_AUX) ? s_aux_root : s_main_root;
}

static void ui_style_screen(lv_obj_t *scr)
{
    lv_obj_set_style_bg_color(scr, lv_color_hex(UI_COL_BG), 0);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);
    lv_obj_set_scrollable(scr, false);
    lv_obj_set_style_pad_all(scr, 0, 0);
    lv_obj_set_style_border_width(scr, 0, 0);
}

static lv_obj_t *ui_label(lv_obj_t *parent, const char *text, const lv_font_t *font,
                          uint32_t colour)
{
    lv_obj_t *label = lv_label_create(parent);
    lv_label_set_text(label, text);
    lv_obj_set_style_text_font(label, font, 0);
    lv_obj_set_style_text_color(label, lv_color_hex(colour), 0);
    lv_label_set_long_mode(label, LV_LABEL_LONG_MODE_WRAP);
    lv_obj_set_style_text_align(label, LV_TEXT_ALIGN_CENTER, 0);
    return label;
}

/* ----------------------------------------------------------- LVGL plumbing */

static void ui_flush_cb(lv_display_t *disp, const lv_area_t *area, uint8_t *px_map)
{
    const echo_display_id_t id =
        (echo_display_id_t)(intptr_t)lv_display_get_user_data(disp);
    const int width = area->x2 - area->x1 + 1;
    const int height = area->y2 - area->y1 + 1;

    if (width > 0 && height > 0) {
        /* LVGL areas are inclusive; the display facade takes exclusive ends. */
        esp_err_t err = echo_display_draw_rgb565(id, area->x1, area->y1, area->x2 + 1,
                                                 area->y2 + 1, (const uint16_t *)px_map);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "flush to panel %d failed: %s", (int)id, esp_err_to_name(err));
        }
        /* One-shot: prove the first band reached a panel. */
        if (s_flush_count == 0) {
            ESP_LOGI(TAG, "first flush -> panel %d area %d,%d %dx%d", (int)id, area->x1,
                     area->y1, width, height);
        }
    }
    s_flush_count++;
    lv_display_flush_ready(disp);
}

static void ui_indev_read_cb(lv_indev_t *indev, lv_indev_data_t *data)
{
    (void)indev;
    echo_touch_point_t point;
    if (echo_display_touch_read(&point)) {
        data->point.x = (int32_t)point.x;
        data->point.y = (int32_t)point.y;
        data->state = point.pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
    } else {
        data->state = LV_INDEV_STATE_RELEASED;
    }
}

static lv_display_t *ui_display_create(echo_display_id_t id, int32_t h_res, int32_t v_res,
                                       int buf_lines, uint32_t mem_caps)
{
    const size_t buf_bytes = (size_t)h_res * (size_t)buf_lines * sizeof(uint16_t);
    /* LVGL draw buffers need cache-line friendly alignment for the DMA paths. */
    void *buf = heap_caps_aligned_alloc(64, buf_bytes, mem_caps | MALLOC_CAP_8BIT);
    if (buf == NULL) {
        ESP_LOGE(TAG, "no memory for the %dx%d LVGL buffer", (int)h_res, (int)v_res);
        return NULL;
    }

    lv_display_t *disp = lv_display_create(h_res, v_res);
    if (disp == NULL) {
        heap_caps_free(buf);
        return NULL;
    }

    lv_display_set_color_format(disp, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(disp, buf, NULL, (uint32_t)buf_bytes,
                           LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(disp, ui_flush_cb);
    lv_display_set_user_data(disp, (void *)(intptr_t)id);
    return disp;
}

/* ------------------------------------------------------- message fallback */

/*
 * Build the "waiting for UI" screen on a panel: a centred column with a title
 * and a body. The renderer may replace it later, but the two labels stay valid
 * so a dropped server can always fall back to a readable message.
 */
static lv_obj_t *ui_build_message_screen(lv_display_t *disp, lv_obj_t **out_title,
                                        lv_obj_t **out_body, int32_t pad)
{
    lv_display_set_default(disp);
    lv_obj_t *scr = lv_obj_create(NULL);
    ui_style_screen(scr);
    lv_obj_set_flex_flow(scr, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(scr, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER,
                          LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_all(scr, pad, 0);
    lv_obj_set_style_pad_row(scr, 12, 0);

    lv_obj_t *title = ui_label(scr, UI_WAITING_TITLE, &echo_font_20, UI_COL_TEXT);
    lv_obj_set_width(title, LV_PCT(100));

    lv_obj_t *body = ui_label(scr, UI_WAITING_BODY, &echo_font_16, UI_COL_MUTED);
    lv_obj_set_width(body, LV_PCT(100));

    lv_screen_load(scr);
    if (out_title != NULL) {
        *out_title = title;
    }
    if (out_body != NULL) {
        *out_body = body;
    }
    return scr;
}

/* Apply a message to both panels. Runs on the UI task, under the LVGL lock. */
static void ui_apply_message(const char *title, const char *body)
{
    if (s_main_title != NULL) {
        lv_label_set_text(s_main_title, title);
    }
    if (s_main_body != NULL) {
        lv_label_set_text(s_main_body, body);
    }
    if (s_aux_title != NULL) {
        lv_label_set_text(s_aux_title, title);
    }
    if (s_aux_body != NULL) {
        lv_label_set_text(s_aux_body, body);
    }
}

static esp_err_t ui_enqueue_message(const char *title, const char *body)
{
    if (s_cmd_queue == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    ui_cmd_t cmd = {};
    cmd.kind = UI_CMD_SHOW_MESSAGE;
    strlcpy(cmd.title, title != NULL ? title : "", sizeof(cmd.title));
    strlcpy(cmd.body, body != NULL ? body : "", sizeof(cmd.body));
    if (xQueueSend(s_cmd_queue, &cmd, 0) != pdTRUE) {
        ESP_LOGW(TAG, "message queue full, dropping update");
        return ESP_ERR_TIMEOUT;
    }
    return ESP_OK;
}

/* ------------------------------------------------------------------ runtime */

static void ui_handle_cmd(const ui_cmd_t *cmd)
{
    switch (cmd->kind) {
    case UI_CMD_SHOW_MESSAGE:
        ui_apply_message(cmd->title, cmd->body);
        break;
    default:
        break;
    }
}

static void ui_task(void *arg)
{
    (void)arg;
    ESP_LOGI(TAG, "LVGL task started");

    while (true) {
        xSemaphoreTake(s_lvgl_lock, portMAX_DELAY);

        /* The bundle renderer's pending work runs here, under the lock. */
        if (s_service_fn != NULL) {
            s_service_fn(s_service_ctx);
        }

        ui_cmd_t cmd;
        while (xQueueReceive(s_cmd_queue, &cmd, 0) == pdTRUE) {
            ui_handle_cmd(&cmd);
        }

        uint32_t period = lv_timer_handler();

        xSemaphoreGive(s_lvgl_lock);

        if (period < UI_MIN_PERIOD_MS) {
            period = UI_MIN_PERIOD_MS;
        } else if (period > UI_MAX_PERIOD_MS) {
            period = UI_MAX_PERIOD_MS;
        }
        vTaskDelay(pdMS_TO_TICKS(period));
    }
}

/* -------------------------------------------------------------------- API */

esp_err_t echo_ui_init(void)
{
    if (s_ready) {
        return ESP_OK;
    }

    lv_init();
    lv_tick_set_cb(ui_tick_ms);

    if (echo_display_ready(ECHO_DISPLAY_MAIN)) {
        s_main_disp = ui_display_create(ECHO_DISPLAY_MAIN, ECHO_DISPLAY_MAIN_H_RES,
                                       ECHO_DISPLAY_MAIN_V_RES, UI_MAIN_BUF_LINES,
                                       MALLOC_CAP_SPIRAM);
    }
    if (echo_display_ready(ECHO_DISPLAY_AUX)) {
        s_aux_disp = ui_display_create(ECHO_DISPLAY_AUX, ECHO_DISPLAY_AUX_H_RES,
                                      ECHO_DISPLAY_AUX_V_RES, UI_AUX_BUF_LINES,
                                      MALLOC_CAP_INTERNAL | MALLOC_CAP_32BIT);
    }
    if (s_main_disp == NULL && s_aux_disp == NULL) {
        ESP_LOGE(TAG, "no ready panel - UI not started");
        return ESP_ERR_INVALID_STATE;
    }

    s_lvgl_lock = xSemaphoreCreateMutex();
    s_cmd_queue = xQueueCreate(4, sizeof(ui_cmd_t));
    if (s_lvgl_lock == NULL || s_cmd_queue == NULL) {
        ESP_LOGE(TAG, "UI synchronisation objects not created");
        return ESP_ERR_NO_MEM;
    }

    /* The fallback message is painted before the task starts: LVGL owns the
     * displays exclusively at this point, so no lock is needed. */
    if (s_main_disp != NULL) {
        s_main_root = ui_build_message_screen(s_main_disp, &s_main_title, &s_main_body, 32);
    }
    if (s_aux_disp != NULL) {
        s_aux_root = ui_build_message_screen(s_aux_disp, &s_aux_title, &s_aux_body, 16);
    }
    lv_display_set_default(s_main_disp != NULL ? s_main_disp : s_aux_disp);

    /* Touch lives on the DSI panel only. The indev stays registered even while
     * only the fallback message is shown, so widgets become interactive as soon
     * as the bundle renderer takes over. */
    bool touch = false;
    if (s_main_disp != NULL && echo_display_touch_ready()) {
        lv_indev_t *indev = lv_indev_create();
        if (indev != NULL) {
            lv_indev_set_type(indev, LV_INDEV_TYPE_POINTER);
            lv_indev_set_read_cb(indev, ui_indev_read_cb);
            lv_indev_set_display(indev, s_main_disp);
            touch = true;
        }
    }

    if (xTaskCreate(ui_task, "echo_ui", UI_TASK_STACK, NULL, UI_TASK_PRIO,
                    &s_ui_task) != pdPASS) {
        ESP_LOGE(TAG, "UI task not created");
        return ESP_ERR_NO_MEM;
    }

    s_ready = true;
    ESP_LOGI(TAG, "LVGL %d.%d ready (main %s, aux %s, touch %s)", LVGL_VERSION_MAJOR,
             LVGL_VERSION_MINOR, s_main_disp != NULL ? "yes" : "no",
             s_aux_disp != NULL ? "yes" : "no", touch ? "yes" : "no");
    return ESP_OK;
}

bool echo_ui_ready(void)
{
    return s_ready;
}

esp_err_t echo_ui_show_message(const char *title, const char *body)
{
    if (!s_ready) {
        return ESP_ERR_INVALID_STATE;
    }
    return ui_enqueue_message(title, body);
}

esp_err_t echo_ui_set_service_hook(echo_ui_service_fn_t fn, void *ctx)
{
    if (!s_ready) {
        return ESP_ERR_INVALID_STATE;
    }
    if (!echo_ui_lock(UI_LOCK_TIMEOUT_MS)) {
        return ESP_ERR_TIMEOUT;
    }
    s_service_fn = fn;
    s_service_ctx = ctx;
    echo_ui_unlock();
    return ESP_OK;
}

lv_display_t *echo_ui_display(echo_screen_t screen)
{
    return ui_display_of(screen);
}

lv_obj_t *echo_ui_screen_root(echo_screen_t screen)
{
    return ui_root_of(screen);
}

esp_err_t echo_ui_screen_load(echo_screen_t screen, lv_obj_t *scr)
{
    if (!s_ready) {
        return ESP_ERR_INVALID_STATE;
    }
    lv_display_t *disp = ui_display_of(screen);
    if (disp == NULL || scr == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!echo_ui_lock(UI_LOCK_TIMEOUT_MS)) {
        return ESP_ERR_TIMEOUT;
    }
    lv_display_set_default(disp);
    lv_screen_load(scr);
    echo_ui_unlock();
    return ESP_OK;
}

bool echo_ui_lock(uint32_t timeout_ms)
{
    if (s_lvgl_lock == NULL) {
        return false;
    }
    return xSemaphoreTake(s_lvgl_lock, pdMS_TO_TICKS(timeout_ms)) == pdTRUE;
}

void echo_ui_unlock(void)
{
    if (s_lvgl_lock != NULL) {
        xSemaphoreGive(s_lvgl_lock);
    }
}
