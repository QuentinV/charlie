/*
 * Bundle parsing.
 *
 * Turns the JSON Charlie serves into the `es_bundle_t` model. The cJSON tree is
 * kept alive for the lifetime of the bundle and every structure points into it,
 * so parsing is a single allocation plus the tree itself.
 *
 * Validation is deliberately strict about the envelope (schema, rev, hash,
 * pages) and lenient about style keys and action verbs: an unknown style key is
 * ignored so the contract can grow without breaking older firmware, while an
 * unknown widget type or action verb rejects the page with a log line.
 */

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_log.h"

#include "echo_screen_internal.h"

static const char *TAG = "es_bundle";

/* ------------------------------------------------------------ colour utils */

bool es_parse_color(const char *s, es_paint_t *out)
{
    if (s == NULL || out == NULL || s[0] != '#') {
        return false;
    }
    size_t len = strlen(s);
    if (len != 7 && len != 9) {
        return false;
    }
    unsigned r, g, b, a = 255;
    if (sscanf(s + 1, "%2x%2x%2x", &r, &g, &b) != 3) {
        return false;
    }
    if (len == 9 && sscanf(s + 7, "%2x", &a) != 1) {
        return false;
    }
    out->set = true;
    out->r = (uint8_t)r;
    out->g = (uint8_t)g;
    out->b = (uint8_t)b;
    out->a = (uint8_t)a;
    return true;
}

bool es_resolve_paint(es_bundle_t *b, const char *s, es_paint_t *out)
{
    if (s == NULL || out == NULL) {
        return false;
    }
    if (s[0] == '#') {
        return es_parse_color(s, out);
    }
    if (b == NULL) {
        return false;
    }
    if (strcmp(s, "theme.bg") == 0) {
        *out = b->theme_bg;
        return out->set;
    }
    if (strcmp(s, "theme.surface") == 0) {
        *out = b->theme_surface;
        return out->set;
    }
    if (strcmp(s, "theme.text") == 0) {
        *out = b->theme_text;
        return out->set;
    }
    if (strcmp(s, "theme.muted") == 0) {
        *out = b->theme_muted;
        return out->set;
    }
    if (strcmp(s, "theme.accent") == 0) {
        *out = b->theme_accent;
        return out->set;
    }
    return false;
}

/* ------------------------------------------------------------- json helpers */

static int16_t json_int(const cJSON *obj, const char *key, int16_t fallback)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
    if (cJSON_IsNumber(item)) {
        return (int16_t)item->valueint;
    }
    return fallback;
}

static const char *json_str(const cJSON *obj, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
    return cJSON_IsString(item) ? item->valuestring : NULL;
}

static bool json_bool(const cJSON *obj, const char *key, bool fallback)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
    if (cJSON_IsBool(item)) {
        return cJSON_IsTrue(item);
    }
    return fallback;
}

static void parse_size(const cJSON *obj, const char *key, int16_t *px, uint8_t *pct)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
    *px = -1; /* "content" */
    *pct = 0;
    if (cJSON_IsNumber(item)) {
        *px = (int16_t)item->valueint;
        return;
    }
    if (cJSON_IsString(item)) {
        const char *s = item->valuestring;
        size_t      len = strlen(s);
        if (len > 1 && s[len - 1] == '%') {
            *pct = (uint8_t)atoi(s);
            *px = -2;
        }
    }
}

static void parse_style(es_bundle_t *b, const cJSON *style, es_style_t *out)
{
    memset(out, 0, sizeof(*out));
    out->flex = ES_FLEX_NONE;
    out->align = ES_ALIGN_LEFT;
    out->valign = ES_VALIGN_TOP;
    out->scroll_dir = ES_SCROLL_NONE;
    out->opacity = 255;
    out->w = -1;
    out->h = -1;
    if (style == NULL) {
        return;
    }

    const char *flex = json_str(style, "flex");
    if (flex != NULL) {
        if (strcmp(flex, "row") == 0) {
            out->flex = ES_FLEX_ROW;
        } else if (strcmp(flex, "column") == 0) {
            out->flex = ES_FLEX_COLUMN;
        }
    }
    const char *align = json_str(style, "align");
    if (align != NULL) {
        if (strcmp(align, "center") == 0) {
            out->align = ES_ALIGN_CENTER;
        } else if (strcmp(align, "right") == 0) {
            out->align = ES_ALIGN_RIGHT;
        }
    }
    const char *valign = json_str(style, "valign");
    if (valign != NULL) {
        if (strcmp(valign, "middle") == 0) {
            out->valign = ES_VALIGN_MIDDLE;
        } else if (strcmp(valign, "bottom") == 0) {
            out->valign = ES_VALIGN_BOTTOM;
        }
    }
    const char *scroll = json_str(style, "scrollDir");
    if (scroll != NULL) {
        if (strcmp(scroll, "v") == 0) {
            out->scroll_dir = ES_SCROLL_VERTICAL;
        } else if (strcmp(scroll, "h") == 0) {
            out->scroll_dir = ES_SCROLL_HORIZONTAL;
        }
    }

    out->gap = json_int(style, "gap", 0);
    out->pad = json_int(style, "pad", 0);
    out->pad_x = json_int(style, "padX", out->pad);
    out->pad_y = json_int(style, "padY", out->pad);
    out->grow = json_int(style, "grow", 0) ? 1 : 0;
    out->radius = (uint8_t)json_int(style, "radius", 0);
    out->font_size = (uint8_t)json_int(style, "size", 0);
    out->precision = (uint8_t)json_int(style, "precision", 0);
    out->opacity = (uint8_t)json_int(style, "opacity", 255);

    parse_size(style, "w", &out->w, &out->w_pct);
    parse_size(style, "h", &out->h, &out->h_pct);

    const char *bg = json_str(style, "bg");
    if (bg != NULL) {
        es_resolve_paint(b, bg, &out->bg);
    }
    const char *color = json_str(style, "color");
    if (color != NULL) {
        es_resolve_paint(b, color, &out->color);
    }
    const cJSON *border = cJSON_GetObjectItemCaseSensitive(style, "border");
    if (cJSON_IsObject(border)) {
        const char *bc = json_str(border, "color");
        if (bc != NULL) {
            es_resolve_paint(b, bc, &out->border_color);
        }
        out->border_w = (uint8_t)json_int(border, "w", 1);
        if (out->border_w == 0) {
            out->border_w = 1;
        }
        if (!out->border_color.set) {
            out->border_color = b->theme_muted;
        }
    }
}

/* ------------------------------------------------------------ action parsing */

static uint8_t action_verb(const char *do_name)
{
    if (do_name == NULL) {
        return ES_ACTION_MAX;
    }
    if (strcmp(do_name, "navigate") == 0) return ES_ACTION_NAVIGATE;
    if (strcmp(do_name, "back") == 0) return ES_ACTION_BACK;
    if (strcmp(do_name, "setVar") == 0) return ES_ACTION_SET_VAR;
    if (strcmp(do_name, "toggleVar") == 0) return ES_ACTION_TOGGLE_VAR;
    if (strcmp(do_name, "show") == 0) return ES_ACTION_SHOW;
    if (strcmp(do_name, "hide") == 0) return ES_ACTION_HIDE;
    if (strcmp(do_name, "enable") == 0) return ES_ACTION_ENABLE;
    if (strcmp(do_name, "disable") == 0) return ES_ACTION_DISABLE;
    if (strcmp(do_name, "wait") == 0) return ES_ACTION_WAIT;
    if (strcmp(do_name, "if") == 0) return ES_ACTION_IF;
    if (strcmp(do_name, "call") == 0) return ES_ACTION_CALL;
    if (strcmp(do_name, "reload") == 0) return ES_ACTION_RELOAD;
    return ES_ACTION_MAX;
}

static uint8_t condition_op(const char *op)
{
    if (op == NULL) return ES_OP_EQ;
    if (strcmp(op, "!=") == 0) return ES_OP_NE;
    if (strcmp(op, ">") == 0) return ES_OP_GT;
    if (strcmp(op, "<") == 0) return ES_OP_LT;
    if (strcmp(op, ">=") == 0) return ES_OP_GE;
    if (strcmp(op, "<=") == 0) return ES_OP_LE;
    if (strcmp(op, "contains") == 0) return ES_OP_CONTAINS;
    if (strcmp(op, "exists") == 0) return ES_OP_EXISTS;
    return ES_OP_EQ;
}

static es_action_t *parse_action_list(const cJSON *list, int depth);

static es_action_t *parse_action(const cJSON *obj, int depth)
{
    if (!cJSON_IsObject(obj)) {
        return NULL;
    }
    if (depth > ES_MAX_ACTION_DEPTH) {
        ESP_LOGW(TAG, "action nesting deeper than %d, dropped", ES_MAX_ACTION_DEPTH);
        return NULL;
    }
    const char *do_name = json_str(obj, "do");
    uint8_t     verb = action_verb(do_name);
    if (verb == ES_ACTION_MAX) {
        ESP_LOGW(TAG, "unknown action verb \"%s\", dropped", do_name ? do_name : "?");
        return NULL;
    }

    es_action_t *a = (es_action_t *)calloc(1, sizeof(*a));
    if (a == NULL) {
        return NULL;
    }
    a->type = verb;

    switch (verb) {
    case ES_ACTION_NAVIGATE:
        a->target = json_str(obj, "page");
        break;
    case ES_ACTION_SET_VAR:
        a->target = json_str(obj, "path");
        a->value = json_str(obj, "value");
        break;
    case ES_ACTION_TOGGLE_VAR:
        a->target = json_str(obj, "path");
        break;
    case ES_ACTION_SHOW:
    case ES_ACTION_HIDE:
    case ES_ACTION_ENABLE:
    case ES_ACTION_DISABLE:
        a->target = json_str(obj, "id");
        break;
    case ES_ACTION_WAIT:
        a->wait_ms = (uint16_t)json_int(obj, "ms", 0);
        break;
    case ES_ACTION_CALL:
        a->target = json_str(obj, "action");
        a->params = cJSON_GetObjectItemCaseSensitive(obj, "params");
        break;
    case ES_ACTION_IF: {
        const cJSON *cond = cJSON_GetObjectItemCaseSensitive(obj, "cond");
        if (cJSON_IsObject(cond)) {
            a->cond.path = json_str(cond, "path");
            a->cond.op = condition_op(json_str(cond, "op"));
            a->cond.value = json_str(cond, "value");
        }
        a->then_list = parse_action_list(cJSON_GetObjectItemCaseSensitive(obj, "then"), depth + 1);
        a->else_list = parse_action_list(cJSON_GetObjectItemCaseSensitive(obj, "else"), depth + 1);
        break;
    }
    default:
        break;
    }
    return a;
}

static es_action_t *parse_action_list(const cJSON *list, int depth)
{
    if (!cJSON_IsArray(list)) {
        return NULL;
    }
    es_action_t *head = NULL;
    es_action_t *tail = NULL;
    const cJSON *item = NULL;
    cJSON_ArrayForEach(item, list) {
        es_action_t *a = parse_action(item, depth);
        if (a == NULL) {
            continue;
        }
        if (tail == NULL) {
            head = a;
        } else {
            tail->next = a;
        }
        tail = a;
    }
    return head;
}

/* --------------------------------------------------------- event bindings */

static const char *event_key(es_event_t ev)
{
    switch (ev) {
    case ES_EV_TAP: return "tap";
    case ES_EV_LONG_PRESS: return "longPress";
    case ES_EV_ENTER: return "enter";
    case ES_EV_LEAVE: return "leave";
    case ES_EV_INTERVAL: return "interval";
    case ES_EV_VAR: return "var";
    case ES_EV_GESTURE: return "gesture";
    default: return NULL;
    }
}

static void parse_event_bindings(const cJSON *on, es_event_binding_t *bindings)
{
    if (!cJSON_IsObject(on)) {
        return;
    }
    for (int ev = 0; ev < ES_EV_MAX; ev++) {
        const cJSON *item = cJSON_GetObjectItemCaseSensitive(on, event_key((es_event_t)ev));
        if (item == NULL) {
            continue;
        }
        es_event_binding_t *b = &bindings[ev];
        if (ev == ES_EV_INTERVAL) {
            b->interval_ms = (uint16_t)json_int(item, "ms", 0);
            b->first = parse_action_list(cJSON_GetObjectItemCaseSensitive(item, "actions"), 0);
        } else if (ev == ES_EV_VAR) {
            b->var_path = json_str(item, "path");
            const cJSON *when = cJSON_GetObjectItemCaseSensitive(item, "when");
            if (cJSON_IsObject(when)) {
                b->var_when.op = condition_op(json_str(when, "op"));
                b->var_when.value = json_str(when, "value");
            }
            b->first = parse_action_list(cJSON_GetObjectItemCaseSensitive(item, "actions"), 0);
        } else if (ev == ES_EV_GESTURE) {
            /* Any gesture key runs the same action list. */
            const cJSON *first = NULL;
            cJSON_ArrayForEach(first, item) {
                b->first = parse_action_list(first, 0);
                break;
            }
        } else {
            b->first = parse_action_list(item, 0);
        }
    }
}

/* ------------------------------------------------------------ node parsing */

static uint8_t node_type(const char *type)
{
    if (type == NULL) return ES_NODE_SCREEN;
    if (strcmp(type, "screen") == 0) return ES_NODE_SCREEN;
    if (strcmp(type, "row") == 0) return ES_NODE_ROW;
    if (strcmp(type, "col") == 0) return ES_NODE_COL;
    if (strcmp(type, "scroll") == 0) return ES_NODE_SCROLL;
    if (strcmp(type, "text") == 0) return ES_NODE_TEXT;
    if (strcmp(type, "button") == 0) return ES_NODE_BUTTON;
    if (strcmp(type, "image") == 0) return ES_NODE_IMAGE;
    if (strcmp(type, "divider") == 0) return ES_NODE_DIVIDER;
    if (strcmp(type, "bar") == 0) return ES_NODE_BAR;
    if (strcmp(type, "toggle") == 0) return ES_NODE_TOGGLE;
    if (strcmp(type, "list") == 0) return ES_NODE_LIST;
    return ES_NODE_MAX;
}

static es_node_t *parse_node(es_bundle_t *b, const cJSON *obj, int depth)
{
    if (!cJSON_IsObject(obj)) {
        return NULL;
    }
    if (depth > ES_MAX_DEPTH) {
        ESP_LOGW(TAG, "widget nesting deeper than %d, dropped", ES_MAX_DEPTH);
        return NULL;
    }
    uint8_t type = node_type(json_str(obj, "type"));
    if (type == ES_NODE_MAX) {
        ESP_LOGW(TAG, "unknown widget type \"%s\", dropped", json_str(obj, "type"));
        return NULL;
    }

    es_node_t *node = (es_node_t *)calloc(1, sizeof(*node));
    if (node == NULL) {
        return NULL;
    }
    node->type = type;
    node->id = json_str(obj, "id");
    node->src = json_str(obj, "src");
    if (json_bool(obj, "hidden", false)) {
        node->flags |= ES_NODE_FLAG_HIDDEN;
    }
    if (json_bool(obj, "disabled", false)) {
        node->flags |= ES_NODE_FLAG_DISABLED;
    }
    parse_style(b, cJSON_GetObjectItemCaseSensitive(obj, "style"), &node->style);
    parse_event_bindings(cJSON_GetObjectItemCaseSensitive(obj, "on"), node->on);

    /* The text-bearing field depends on the widget type. */
    const char *source = NULL;
    if (type == ES_NODE_TEXT) {
        source = json_str(obj, "text");
    } else if (type == ES_NODE_BUTTON || type == ES_NODE_TOGGLE) {
        source = json_str(obj, "label");
    }
    if (source != NULL) {
        node->text = source;
        es_bind_compile(source, &node->segments, &node->segment_count);
    }
    const char *value = json_str(obj, "value");
    if (value != NULL) {
        node->value = value;
        es_bind_compile(value, &node->value_segments, &node->value_segment_count);
    }

    const cJSON *children = cJSON_GetObjectItemCaseSensitive(obj, "children");
    if (cJSON_IsArray(children)) {
        es_node_t *tail = NULL;
        const cJSON *child = NULL;
        cJSON_ArrayForEach(child, children) {
            es_node_t *n = parse_node(b, child, depth + 1);
            if (n == NULL) {
                continue;
            }
            if (tail == NULL) {
                node->first_child = n;
            } else {
                tail->next_sibling = n;
            }
            tail = n;
        }
    }
    return node;
}

/* ------------------------------------------------------------ page parsing */

static uint8_t parse_targets(const cJSON *arr)
{
    uint8_t targets = 0;
    if (!cJSON_IsArray(arr)) {
        return ES_TARGET_MAIN | ES_TARGET_AUX;
    }
    const cJSON *item = NULL;
    cJSON_ArrayForEach(item, arr) {
        if (!cJSON_IsString(item)) {
            continue;
        }
        if (strcmp(item->valuestring, "main") == 0) {
            targets |= ES_TARGET_MAIN;
        } else if (strcmp(item->valuestring, "aux") == 0) {
            targets |= ES_TARGET_AUX;
        }
    }
    return targets != 0 ? targets : (ES_TARGET_MAIN | ES_TARGET_AUX);
}

static void free_actions(es_action_t *a)
{
    while (a != NULL) {
        es_action_t *next = a->next;
        free_actions(a->then_list);
        free_actions(a->else_list);
        free(a);
        a = next;
    }
}

static void free_nodes(es_node_t *n)
{
    while (n != NULL) {
        es_node_t *next = n->next_sibling;
        free_nodes(n->first_child);
        es_bind_free(n->segments, n->segment_count);
        es_bind_free(n->value_segments, n->value_segment_count);
        for (int ev = 0; ev < ES_EV_MAX; ev++) {
            free_actions(n->on[ev].first);
        }
        free(n);
        n = next;
    }
}

void es_bundle_free(es_bundle_t *b)
{
    if (b == NULL) {
        return;
    }
    for (uint16_t i = 0; i < b->page_count; i++) {
        free_nodes(b->pages[i].root);
        for (int ev = 0; ev < ES_EV_MAX; ev++) {
            free_actions(b->pages[i].on[ev].first);
        }
    }
    free(b->pages);
    if (b->json != NULL) {
        cJSON_Delete(b->json);
    }
    free(b);
}

/* --------------------------------------------------------------- the parser */

static void parse_theme(es_bundle_t *b, const cJSON *theme)
{
    if (!cJSON_IsObject(theme)) {
        return;
    }
    const char *bg = json_str(theme, "bg");
    if (bg != NULL) {
        es_parse_color(bg, &b->theme_bg);
    }
    const char *surface = json_str(theme, "surface");
    if (surface != NULL) {
        es_parse_color(surface, &b->theme_surface);
    }
    const char *text = json_str(theme, "text");
    if (text != NULL) {
        es_parse_color(text, &b->theme_text);
    }
    const char *muted = json_str(theme, "muted");
    if (muted != NULL) {
        es_parse_color(muted, &b->theme_muted);
    }
    const char *accent = json_str(theme, "accent");
    if (accent != NULL) {
        es_parse_color(accent, &b->theme_accent);
    }
    b->theme_radius = (uint8_t)json_int(theme, "radius", 12);
}

static void parse_vars(es_bundle_t *b, const cJSON *vars)
{
    if (!cJSON_IsObject(vars)) {
        return;
    }
    const cJSON *item = NULL;
    cJSON_ArrayForEach(item, vars) {
        if (b->var_count >= ES_MAX_VARS) {
            ESP_LOGW(TAG, "more than %d variables, extras ignored", ES_MAX_VARS);
            break;
        }
        const char *path = item->string;
        if (path == NULL) {
            continue;
        }
        uint8_t  kind = ES_VAR_LOCAL;
        uint8_t  type = ES_VAR_STRING;
        uint32_t ttl = 0;
        if (cJSON_IsObject(item)) {
            const char *k = json_str(item, "kind");
            if (k != NULL && strcmp(k, "remote") == 0) {
                kind = ES_VAR_REMOTE;
            }
            const char *t = json_str(item, "type");
            if (t != NULL) {
                if (strcmp(t, "int") == 0) {
                    type = ES_VAR_INT;
                } else if (strcmp(t, "float") == 0) {
                    type = ES_VAR_FLOAT;
                } else if (strcmp(t, "bool") == 0) {
                    type = ES_VAR_BOOL;
                }
            }
            ttl = (uint32_t)json_int(item, "ttl", 0);
        }
        b->vars[b->var_count].path = path;
        b->vars[b->var_count].kind = kind;
        b->vars[b->var_count].type = type;
        b->vars[b->var_count].ttl_ms = ttl;
        b->var_count++;
        es_vars_declare(path, kind, type, ttl);
    }
}

es_bundle_t *es_bundle_parse(const char *json, size_t len)
{
    if (json == NULL || len == 0) {
        return NULL;
    }
    if (len > ES_MAX_BUNDLE_BYTES) {
        ESP_LOGE(TAG, "bundle is %u bytes, limit is %d", (unsigned)len, ES_MAX_BUNDLE_BYTES);
        return NULL;
    }
    cJSON *root = cJSON_ParseWithLength(json, len);
    if (root == NULL) {
        ESP_LOGE(TAG, "bundle is not valid JSON");
        return NULL;
    }
    const cJSON *schema = cJSON_GetObjectItemCaseSensitive(root, "schema");
    if (!cJSON_IsNumber(schema) || schema->valueint != ES_SCHEMA_VERSION) {
        ESP_LOGE(TAG, "unsupported bundle schema %d",
                 cJSON_IsNumber(schema) ? schema->valueint : -1);
        cJSON_Delete(root);
        return NULL;
    }
    const cJSON *pages = cJSON_GetObjectItemCaseSensitive(root, "pages");
    if (!cJSON_IsArray(pages) || cJSON_GetArraySize(pages) == 0) {
        ESP_LOGE(TAG, "bundle has no pages");
        cJSON_Delete(root);
        return NULL;
    }
    if (cJSON_GetArraySize(pages) > ES_MAX_PAGES) {
        ESP_LOGE(TAG, "bundle has %d pages, limit is %d", cJSON_GetArraySize(pages), ES_MAX_PAGES);
        cJSON_Delete(root);
        return NULL;
    }

    es_bundle_t *b = (es_bundle_t *)calloc(1, sizeof(*b));
    if (b == NULL) {
        cJSON_Delete(root);
        return NULL;
    }
    b->json = root;
    b->rev = (uint32_t)json_int(root, "rev", 0);
    const char *hash = json_str(root, "hash");
    if (hash != NULL) {
        strncpy(b->hash, hash, sizeof(b->hash) - 1);
    }
    b->targets_default[0] = 0xFF;
    b->targets_default[1] = 0xFF;

    parse_theme(b, cJSON_GetObjectItemCaseSensitive(root, "theme"));
    parse_vars(b, cJSON_GetObjectItemCaseSensitive(root, "vars"));

    const cJSON *defaults = cJSON_GetObjectItemCaseSensitive(root, "defaults");

    b->pages = (es_page_t *)calloc(cJSON_GetArraySize(pages), sizeof(es_page_t));
    if (b->pages == NULL) {
        es_bundle_free(b);
        return NULL;
    }

    const cJSON *page = NULL;
    cJSON_ArrayForEach(page, pages) {
        if (!cJSON_IsObject(page)) {
            continue;
        }
        es_page_t *p = &b->pages[b->page_count];
        p->id = json_str(page, "id");
        if (p->id == NULL) {
            ESP_LOGW(TAG, "page without id, skipped");
            continue;
        }
        p->targets = parse_targets(cJSON_GetObjectItemCaseSensitive(page, "targets"));
        p->title = json_str(page, "title");
        parse_event_bindings(cJSON_GetObjectItemCaseSensitive(page, "on"), p->on);
        p->root = parse_node(b, cJSON_GetObjectItemCaseSensitive(page, "root"), 1);
        if (p->root == NULL) {
            ESP_LOGW(TAG, "page \"%s\" has no renderable root, skipped", p->id);
            continue;
        }
        b->page_count++;
    }

    if (b->page_count == 0) {
        ESP_LOGE(TAG, "bundle has no usable pages");
        es_bundle_free(b);
        return NULL;
    }

    /* Resolve the default page per panel. */
    if (cJSON_IsObject(defaults)) {
        const char *main_page = json_str(defaults, "main");
        const char *aux_page = json_str(defaults, "aux");
        for (uint16_t i = 0; i < b->page_count; i++) {
            if (main_page != NULL && strcmp(b->pages[i].id, main_page) == 0) {
                b->targets_default[0] = (uint8_t)i;
            }
            if (aux_page != NULL && strcmp(b->pages[i].id, aux_page) == 0) {
                b->targets_default[1] = (uint8_t)i;
            }
        }
    }
    if (b->targets_default[0] == 0xFF) {
        for (uint16_t i = 0; i < b->page_count; i++) {
            if (b->pages[i].targets & ES_TARGET_MAIN) {
                b->targets_default[0] = (uint8_t)i;
                break;
            }
        }
    }
    if (b->targets_default[1] == 0xFF) {
        for (uint16_t i = 0; i < b->page_count; i++) {
            if (b->pages[i].targets & ES_TARGET_AUX) {
                b->targets_default[1] = (uint8_t)i;
                break;
            }
        }
    }

    ESP_LOGI(TAG, "bundle rev %u, %u pages, %u vars", b->rev, b->page_count, b->var_count);
    return b;
}
