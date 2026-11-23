/*
 * Action interpreter and page stack.
 *
 * Everything in this file runs on the UI task, inside the LVGL lock: the
 * service hook drains the request queue and executes the chains there. Actions
 * the device can satisfy locally (navigate, back, setVar, toggleVar, show, hide,
 * enable, disable, wait, if, reload) never leave the board; only `call` reaches
 * Charlie, and it is handed to the fetch task as a fire-and-forget POST.
 *
 * The page stack is per panel. A bundle page may target both panels, so the
 * renderer keeps one LVGL screen per panel per page (es_page_t::screen[2]).
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#include "echo_events.h"
#include "echo_screen_internal.h"
#include "echo_ui.h"

static const char *TAG = "es_actions";

#define ES_STACK_DEPTH 8
#define ES_QUEUE_DEPTH 16
#define ES_WAIT_MAX_MS 2000
#define ES_DRAIN_PER_TICK 4

/** A queued request: a chain, a navigate, a back or a step. */
typedef struct {
    uint8_t       kind;  /* 0 = chain, 1 = navigate, 2 = back, 3 = step */
    echo_screen_t panel;
    const char   *page;  /* navigate target; points into the retained bundle */
    int           delta; /* step direction */
    es_action_t  *first; /* chain head */
} es_request_t;

static QueueHandle_t s_queue;

static uint8_t s_stack[2][ES_STACK_DEPTH];
static uint8_t s_depth[2];
static uint8_t s_current[2];

static uint8_t panel_index(echo_screen_t panel)
{
    return panel == ECHO_SCREEN_AUX ? 1 : 0;
}

static bool ensure_init(void)
{
    if (s_queue != NULL) {
        return true;
    }
    s_queue = xQueueCreate(ES_QUEUE_DEPTH, sizeof(es_request_t));
    if (s_queue == NULL) {
        return false;
    }
    for (uint8_t i = 0; i < 2; i++) {
        s_depth[i] = 0;
        s_current[i] = 0xFF;
    }
    return true;
}

/* --------------------------------------------------------------- page lookup */

static uint8_t find_page(const char *id)
{
    es_bundle_t *b = es_bundle();
    if (b == NULL || id == NULL) {
        return 0xFF;
    }
    for (uint8_t i = 0; i < b->page_count; i++) {
        if (b->pages[i].id != NULL && strcmp(b->pages[i].id, id) == 0) {
            return i;
        }
    }
    return 0xFF;
}

static es_node_t *find_node(es_node_t *node, const char *id)
{
    if (node == NULL || id == NULL) {
        return NULL;
    }
    for (es_node_t *n = node->first_child; n != NULL; n = n->next_sibling) {
        if (n->id != NULL && strcmp(n->id, id) == 0) {
            return n;
        }
        es_node_t *hit = find_node(n, id);
        if (hit != NULL) {
            return hit;
        }
    }
    return NULL;
}

/* ------------------------------------------------------------ page switching */

static esp_err_t show_page(echo_screen_t panel, uint8_t page_index, bool push)
{
    es_bundle_t *b = es_bundle();
    if (b == NULL || page_index >= b->page_count) {
        return ESP_ERR_INVALID_ARG;
    }
    es_page_t *page = &b->pages[page_index];
    uint8_t    want = panel == ECHO_SCREEN_AUX ? ES_TARGET_AUX : ES_TARGET_MAIN;
    if ((page->targets & want) == 0) {
        return ESP_ERR_NOT_FOUND;
    }

    lv_display_t *disp = echo_ui_display(panel);
    if (disp == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    esp_err_t err = es_render_page(page, disp);
    if (err != ESP_OK) {
        return err;
    }

    uint8_t slot = panel_index(panel);
    if (page->screen[slot] == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    /* Already on the UI task under the LVGL lock: load directly instead of
     * going through echo_ui_screen_load(), which would take the lock again. */
    lv_display_set_default(disp);
    lv_screen_load(page->screen[slot]);

    if (push) {
        if (s_depth[slot] < ES_STACK_DEPTH) {
            s_stack[slot][s_depth[slot]++] = page_index;
        } else {
            /* Full: drop the oldest entry so navigation keeps moving. */
            memmove(s_stack[slot], s_stack[slot] + 1,
                    sizeof(s_stack[slot][0]) * (ES_STACK_DEPTH - 1));
            s_stack[slot][ES_STACK_DEPTH - 1] = page_index;
        }
    }
    s_current[slot] = page_index;

    echo_ui_page_t ev = {};
    ev.screen = panel;
    if (page->id != NULL) {
        strncpy(ev.page, page->id, sizeof(ev.page) - 1);
    }
    echo_event_bus_post(ECHO_EVT_UI_PAGE_CHANGED, &ev, sizeof(ev));

    ESP_LOGI(TAG, "panel %d -> page %s", (int)panel, page->id ? page->id : "?");
    return ESP_OK;
}

esp_err_t es_actions_show(echo_screen_t panel, uint8_t page_index)
{
    if (!ensure_init()) {
        return ESP_ERR_NO_MEM;
    }
    return show_page(panel, page_index, true);
}

esp_err_t es_navigate_internal(echo_screen_t panel, const char *page_id)
{
    if (!ensure_init()) {
        return ESP_ERR_NO_MEM;
    }
    uint8_t idx = find_page(page_id);
    if (idx == 0xFF) {
        ESP_LOGW(TAG, "navigate: no page \"%s\"", page_id ? page_id : "?");
        return ESP_ERR_NOT_FOUND;
    }
    return show_page(panel, idx, true);
}

esp_err_t es_navigate_back(echo_screen_t panel)
{
    if (!ensure_init()) {
        return ESP_ERR_NO_MEM;
    }
    uint8_t slot = panel_index(panel);
    if (s_depth[slot] <= 1) {
        return ESP_ERR_NOT_FOUND; /* nothing to go back to */
    }
    s_depth[slot]--;
    return show_page(panel, s_stack[slot][s_depth[slot] - 1], false);
}

esp_err_t es_actions_step(echo_screen_t panel, int delta)
{
    es_bundle_t *b = es_bundle();
    if (b == NULL || b->page_count == 0) {
        return ESP_ERR_INVALID_STATE;
    }
    uint8_t slot = panel_index(panel);
    uint8_t cur = s_current[slot];
    if (cur == 0xFF) {
        return ESP_ERR_INVALID_STATE;
    }
    uint8_t want = panel == ECHO_SCREEN_AUX ? ES_TARGET_AUX : ES_TARGET_MAIN;
    uint8_t i = cur;
    for (uint16_t tries = 0; tries < b->page_count; tries++) {
        i = (uint8_t)((i + delta + b->page_count) % b->page_count);
        if (b->pages[i].targets & want) {
            return show_page(panel, i, false);
        }
    }
    return ESP_ERR_NOT_FOUND;
}

void es_actions_reset(echo_screen_t panel)
{
    uint8_t slot = panel_index(panel);
    s_depth[slot] = 0;
    s_current[slot] = 0xFF;
}

uint8_t es_actions_current(echo_screen_t panel)
{
    return s_current[panel_index(panel)];
}

/* ------------------------------------------------------------ condition eval */

static int compare_numbers(const char *a, const char *b)
{
    double da = strtod(a, NULL);
    double db = strtod(b, NULL);
    if (da < db) {
        return -1;
    }
    if (da > db) {
        return 1;
    }
    return 0;
}

static bool condition_holds(const es_condition_t *cond)
{
    if (cond == NULL || cond->path == NULL) {
        return false;
    }
    const char *value = echo_screen_var_get(cond->path);
    if (cond->op == ES_OP_EXISTS) {
        return value != NULL;
    }
    if (value == NULL) {
        return false;
    }
    const char *want = cond->value != NULL ? cond->value : "";
    switch (cond->op) {
    case ES_OP_EQ: return strcmp(value, want) == 0;
    case ES_OP_NE: return strcmp(value, want) != 0;
    case ES_OP_GT: return compare_numbers(value, want) > 0;
    case ES_OP_LT: return compare_numbers(value, want) < 0;
    case ES_OP_GE: return compare_numbers(value, want) >= 0;
    case ES_OP_LE: return compare_numbers(value, want) <= 0;
    case ES_OP_CONTAINS: return strstr(value, want) != NULL;
    default: return false;
    }
}

/* ------------------------------------------------------------ widget helpers */

static es_node_t *current_page_root(echo_screen_t panel)
{
    uint8_t idx = s_current[panel_index(panel)];
    es_bundle_t *b = es_bundle();
    if (b == NULL || idx == 0xFF || idx >= b->page_count) {
        return NULL;
    }
    return b->pages[idx].root;
}

static void set_node_flag(echo_screen_t panel, const char *id, bool hidden, bool disabled)
{
    es_node_t *node = find_node(current_page_root(panel), id);
    if (node == NULL) {
        ESP_LOGW(TAG, "widget \"%s\" not on this page", id ? id : "?");
        return;
    }
    if (hidden) {
        node->flags |= ES_NODE_FLAG_HIDDEN;
    } else {
        node->flags &= (uint16_t)~ES_NODE_FLAG_HIDDEN;
    }
    if (disabled) {
        node->flags |= ES_NODE_FLAG_DISABLED;
    } else {
        node->flags &= (uint16_t)~ES_NODE_FLAG_DISABLED;
    }
    if (node->obj != NULL) {
        if (hidden) {
            lv_obj_add_flag(node->obj, LV_OBJ_FLAG_HIDDEN);
        } else {
            lv_obj_remove_flag(node->obj, LV_OBJ_FLAG_HIDDEN);
        }
        if (disabled) {
            lv_obj_add_state(node->obj, LV_STATE_DISABLED);
        } else {
            lv_obj_remove_state(node->obj, LV_STATE_DISABLED);
        }
    }
}

static void toggle_variable(const char *path)
{
    if (path == NULL) {
        return;
    }
    const char *current = echo_screen_var_get(path);
    bool on = current != NULL &&
              (strcmp(current, "true") == 0 || strcmp(current, "1") == 0 ||
               strcmp(current, "on") == 0);
    echo_screen_var_set(path, on ? "false" : "true");
}

/* ---------------------------------------------------------- the interpreter */

void es_actions_run(es_action_t *first, echo_screen_t panel, const char *page_id)
{
    (void)page_id;
    for (es_action_t *a = first; a != NULL; a = a->next) {
        switch (a->type) {
        case ES_ACTION_NAVIGATE:
            if (a->target != NULL) {
                es_navigate_internal(panel, a->target);
            }
            break;
        case ES_ACTION_BACK:
            es_navigate_back(panel);
            break;
        case ES_ACTION_SET_VAR:
            if (a->target != NULL && a->value != NULL) {
                echo_screen_var_set(a->target, a->value);
            }
            break;
        case ES_ACTION_TOGGLE_VAR:
            toggle_variable(a->target);
            break;
        case ES_ACTION_SHOW:
            set_node_flag(panel, a->target, false, false);
            break;
        case ES_ACTION_HIDE:
            set_node_flag(panel, a->target, true, false);
            break;
        case ES_ACTION_ENABLE:
            set_node_flag(panel, a->target, false, false);
            break;
        case ES_ACTION_DISABLE:
            set_node_flag(panel, a->target, false, true);
            break;
        case ES_ACTION_WAIT: {
            uint16_t ms = a->wait_ms > ES_WAIT_MAX_MS ? ES_WAIT_MAX_MS : a->wait_ms;
            if (ms > 0) {
                vTaskDelay(pdMS_TO_TICKS(ms));
            }
            break;
        }
        case ES_ACTION_IF:
            if (condition_holds(&a->cond)) {
                es_actions_run(a->then_list, panel, page_id);
            } else {
                es_actions_run(a->else_list, panel, page_id);
            }
            break;
        case ES_ACTION_CALL:
            if (a->target != NULL) {
                es_fetch_post_action(a->target, a->params);
            }
            break;
        case ES_ACTION_RELOAD:
            es_fetch_wake();
            break;
        default:
            ESP_LOGW(TAG, "unhandled action verb %u", a->type);
            break;
        }
    }
}

/* ------------------------------------------------------------------ queueing */

esp_err_t es_actions_post(es_action_t *first, echo_screen_t panel, const char *page_id)
{
    if (first == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!ensure_init()) {
        return ESP_ERR_NO_MEM;
    }
    es_request_t req = {0};
    req.kind = 0;
    req.panel = panel;
    req.page = page_id;
    req.first = first;
    if (xQueueSend(s_queue, &req, 0) != pdTRUE) {
        ESP_LOGW(TAG, "action queue full, request dropped");
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

esp_err_t echo_screen_navigate(echo_screen_t panel, const char *page_id)
{
    if (page_id == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!ensure_init()) {
        return ESP_ERR_NO_MEM;
    }
    es_request_t req = {0};
    req.kind = 1;
    req.panel = panel;
    req.page = page_id;
    if (xQueueSend(s_queue, &req, 0) != pdTRUE) {
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

esp_err_t es_actions_post_step(echo_screen_t panel, int delta)
{
    if (!ensure_init()) {
        return ESP_ERR_NO_MEM;
    }
    es_request_t req = {0};
    req.kind = 3;
    req.panel = panel;
    req.delta = delta;
    if (xQueueSend(s_queue, &req, 0) != pdTRUE) {
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

esp_err_t echo_screen_back(echo_screen_t panel)
{
    if (!ensure_init()) {
        return ESP_ERR_NO_MEM;
    }
    es_request_t req = {0};
    req.kind = 2;
    req.panel = panel;
    if (xQueueSend(s_queue, &req, 0) != pdTRUE) {
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

void es_actions_service(void)
{
    if (s_queue == NULL) {
        return;
    }
    for (int i = 0; i < ES_DRAIN_PER_TICK; i++) {
        es_request_t req;
        if (xQueueReceive(s_queue, &req, 0) != pdTRUE) {
            return;
        }
        switch (req.kind) {
        case 1:
            es_navigate_internal(req.panel, req.page);
            break;
        case 2:
            es_navigate_back(req.panel);
            break;
        case 3:
            es_actions_step(req.panel, req.delta);
            break;
        default:
            es_actions_run(req.first, req.panel, req.page);
            break;
        }
    }
}
