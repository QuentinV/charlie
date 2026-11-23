/*
 * LVGL renderer.
 *
 * Turns a parsed page into LVGL objects. The mapping is deliberately thin: the
 * bundle already describes a flex layout, so LVGL's own flex engine does the
 * positioning and the same page reflows onto both panels.
 *
 * Every call here runs on the UI task, inside the LVGL lock. The service hook
 * in echo_screen.cpp owns that guarantee.
 */

#include <stdio.h>
#include <string.h>

#include "esp_log.h"

#include "echo_ui.h"
#include "echo_screen_internal.h"

static const char *TAG = "es_render";

LV_FONT_DECLARE(echo_font_12);
LV_FONT_DECLARE(echo_font_16);
LV_FONT_DECLARE(echo_font_20);
LV_FONT_DECLARE(echo_font_28);
LV_FONT_DECLARE(echo_font_40);
LV_FONT_DECLARE(echo_font_56);

/* --------------------------------------------------------------- helpers */

static const lv_font_t *font_for(uint8_t size)
{
    switch (size) {
    case 12: return &echo_font_12;
    case 16: return &echo_font_16;
    case 20: return &echo_font_20;
    case 28: return &echo_font_28;
    case 40: return &echo_font_40;
    case 56: return &echo_font_56;
    default: return &echo_font_20;
    }
}

static lv_color_t color_of(const es_paint_t *p, lv_color_t fallback)
{
    if (!p->set) {
        return fallback;
    }
    return lv_color_make(p->r, p->g, p->b);
}

/* Theme paints are stored as es_paint_t; LVGL wants an lv_color_t. */
static lv_color_t paint_color(const es_paint_t *p, lv_color_t fallback)
{
    return p->set ? lv_color_make(p->r, p->g, p->b) : fallback;
}

static lv_opa_t opa_of(const es_paint_t *p)
{
    return p->set ? (lv_opa_t)p->a : LV_OPA_COVER;
}

static void apply_size(lv_obj_t *obj, const es_style_t *s)
{
    if (s->w_pct) {
        lv_obj_set_width(obj, lv_pct(s->w_pct));
    } else if (s->w >= 0) {
        lv_obj_set_width(obj, s->w);
    }
    if (s->h_pct) {
        lv_obj_set_height(obj, lv_pct(s->h_pct));
    } else if (s->h >= 0) {
        lv_obj_set_height(obj, s->h);
    }
}

static void apply_style(lv_obj_t *obj, const es_style_t *s, es_bundle_t *b)
{
    if (s->bg.set) {
        lv_obj_set_style_bg_color(obj, color_of(&s->bg, lv_color_white()), 0);
        lv_obj_set_style_bg_opa(obj, opa_of(&s->bg), 0);
    } else {
        lv_obj_set_style_bg_opa(obj, LV_OPA_TRANSP, 0);
    }
    if (s->radius) {
        lv_obj_set_style_radius(obj, s->radius, 0);
    }
    if (s->border_w) {
        lv_obj_set_style_border_width(obj, s->border_w, 0);
        lv_obj_set_style_border_color(obj,
                                      color_of(&s->border_color,
                                               paint_color(&b->theme_muted, lv_color_hex(0x93A0B0))),
                                      0);
    }
    if (s->pad || s->pad_x || s->pad_y) {
        int16_t pad = s->pad;
        int16_t pad_x = s->pad_x ? s->pad_x : pad;
        int16_t pad_y = s->pad_y ? s->pad_y : pad;
        lv_obj_set_style_pad_hor(obj, pad_x, 0);
        lv_obj_set_style_pad_ver(obj, pad_y, 0);
    }
    if (s->opacity && s->opacity < 255) {
        lv_obj_set_style_opa(obj, (lv_opa_t)s->opacity, 0);
    }
    apply_size(obj, s);
}

static void apply_flex(lv_obj_t *obj, const es_style_t *s)
{
    if (s->flex == ES_FLEX_ROW) {
        lv_obj_set_flex_flow(obj, LV_FLEX_FLOW_ROW);
    } else if (s->flex == ES_FLEX_COLUMN) {
        lv_obj_set_flex_flow(obj, LV_FLEX_FLOW_COLUMN);
    } else {
        return;
    }
    lv_flex_align_t main = LV_FLEX_ALIGN_START;
    lv_flex_align_t cross = LV_FLEX_ALIGN_START;
    if (s->align == ES_ALIGN_CENTER) {
        main = LV_FLEX_ALIGN_CENTER;
    } else if (s->align == ES_ALIGN_RIGHT) {
        main = LV_FLEX_ALIGN_END;
    }
    if (s->valign == ES_VALIGN_MIDDLE) {
        cross = LV_FLEX_ALIGN_CENTER;
    } else if (s->valign == ES_VALIGN_BOTTOM) {
        cross = LV_FLEX_ALIGN_END;
    }
    lv_obj_set_flex_align(obj, main, cross, LV_FLEX_ALIGN_START);
    if (s->gap) {
        if (s->flex == ES_FLEX_ROW) {
            lv_obj_set_style_pad_column(obj, s->gap, 0);
        } else {
            lv_obj_set_style_pad_row(obj, s->gap, 0);
        }
    }
}

static void apply_text_style(lv_obj_t *obj, const es_style_t *s, es_bundle_t *b)
{
    lv_obj_set_style_text_font(obj, font_for(s->font_size), 0);
    lv_obj_set_style_text_color(obj, color_of(&s->color, paint_color(&b->theme_text, lv_color_white())), 0);
    if (s->align == ES_ALIGN_CENTER) {
        lv_obj_set_style_text_align(obj, LV_TEXT_ALIGN_CENTER, 0);
    } else if (s->align == ES_ALIGN_RIGHT) {
        lv_obj_set_style_text_align(obj, LV_TEXT_ALIGN_RIGHT, 0);
    }
}

/* ------------------------------------------------------------ event bridge */

/* The panel a rendered widget belongs to, stashed in the LVGL user data. */
typedef struct {
    echo_screen_t panel;
    es_node_t    *node;
} es_widget_ctx_t;

static void widget_event_cb(lv_event_t *e)
{
    lv_event_code_t  code = lv_event_get_code(e);
    es_widget_ctx_t *ctx = (es_widget_ctx_t *)lv_event_get_user_data(e);
    if (ctx == NULL || ctx->node == NULL) {
        return;
    }
    es_event_t ev;
    if (code == LV_EVENT_CLICKED) {
        ev = ES_EV_TAP;
    } else if (code == LV_EVENT_LONG_PRESSED) {
        ev = ES_EV_LONG_PRESS;
    } else {
        return;
    }
    if (ctx->node->on[ev].first != NULL) {
        es_actions_post(ctx->node->on[ev].first, ctx->panel, NULL);
    }
}

static void render_children(lv_obj_t *parent, es_node_t *first, es_bundle_t *b,
                            echo_screen_t panel);

static lv_obj_t *render_node(es_node_t *node, lv_obj_t *parent, es_bundle_t *b,
                             echo_screen_t panel)
{
    lv_obj_t *obj = NULL;

    switch (node->type) {
    case ES_NODE_SCREEN:
    case ES_NODE_ROW:
    case ES_NODE_COL:
    case ES_NODE_SCROLL:
    case ES_NODE_LIST: {
        obj = lv_obj_create(parent);
        lv_obj_remove_style_all(obj);
        lv_obj_set_layout(obj, LV_LAYOUT_FLEX);
        apply_style(obj, &node->style, b);
        apply_flex(obj, &node->style);
        if (node->type == ES_NODE_SCROLL || node->type == ES_NODE_LIST) {
            lv_obj_set_scroll_dir(obj, node->style.scroll_dir == ES_SCROLL_HORIZONTAL
                                           ? LV_DIR_HOR
                                           : LV_DIR_VER);
        }
        render_children(obj, node->first_child, b, panel);
        break;
    }
    case ES_NODE_TEXT: {
        obj = lv_label_create(parent);
        char text[512];
        es_bind_render(node->segments, node->segment_count, text, sizeof(text));
        lv_label_set_text(obj, text);
        apply_text_style(obj, &node->style, b);
        apply_size(obj, &node->style);
        break;
    }
    case ES_NODE_BUTTON: {
        obj = lv_obj_create(parent);
        lv_obj_remove_style_all(obj);
        lv_obj_set_layout(obj, LV_LAYOUT_FLEX);
        lv_obj_set_flex_flow(obj, LV_FLEX_FLOW_ROW);
        lv_obj_set_flex_align(obj, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER,
                              LV_FLEX_ALIGN_CENTER);
        apply_style(obj, &node->style, b);
        if (!node->style.bg.set) {
            lv_obj_set_style_bg_color(obj, color_of(&b->theme_surface, lv_color_hex(0x1A212A)), 0);
            lv_obj_set_style_bg_opa(obj, LV_OPA_COVER, 0);
            lv_obj_set_style_radius(obj, b->theme_radius, 0);
        }
        lv_obj_add_flag(obj, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_t *label = lv_label_create(obj);
        char text[256];
        es_bind_render(node->segments, node->segment_count, text, sizeof(text));
        lv_label_set_text(label, text);
        apply_text_style(label, &node->style, b);
        node->text_obj = label;
        break;
    }
    case ES_NODE_IMAGE: {
        /* Phase 4: real image loading. A labelled placeholder keeps the layout
         * stable so pages authored with images still render. */
        obj = lv_obj_create(parent);
        lv_obj_remove_style_all(obj);
        apply_style(obj, &node->style, b);
        if (!node->style.bg.set) {
            lv_obj_set_style_bg_color(obj, color_of(&b->theme_surface, lv_color_hex(0x1A212A)), 0);
            lv_obj_set_style_bg_opa(obj, LV_OPA_COVER, 0);
        }
        lv_obj_t *label = lv_label_create(obj);
        lv_label_set_text(label, node->src ? node->src : "image");
        apply_text_style(label, &node->style, b);
        break;
    }
    case ES_NODE_DIVIDER: {
        obj = lv_obj_create(parent);
        lv_obj_remove_style_all(obj);
        lv_obj_set_height(obj, 1);
        lv_obj_set_width(obj, lv_pct(100));
        lv_obj_set_style_bg_color(obj, color_of(&b->theme_muted, lv_color_hex(0x93A0B0)), 0);
        lv_obj_set_style_bg_opa(obj, LV_OPA_40, 0);
        break;
    }
    case ES_NODE_BAR: {
        obj = lv_bar_create(parent);
        lv_bar_set_range(obj, 0, 100);
        char value[32];
        es_bind_render(node->value_segments, node->value_segment_count, value, sizeof(value));
        lv_bar_set_value(obj, atoi(value), LV_ANIM_OFF);
        apply_style(obj, &node->style, b);
        break;
    }
    case ES_NODE_TOGGLE: {
        obj = lv_obj_create(parent);
        lv_obj_remove_style_all(obj);
        lv_obj_set_layout(obj, LV_LAYOUT_FLEX);
        lv_obj_set_flex_flow(obj, LV_FLEX_FLOW_ROW);
        lv_obj_set_flex_align(obj, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER,
                              LV_FLEX_ALIGN_CENTER);
        apply_style(obj, &node->style, b);
        lv_obj_t *label = lv_label_create(obj);
        char text[128];
        es_bind_render(node->segments, node->segment_count, text, sizeof(text));
        lv_label_set_text(label, text);
        apply_text_style(label, &node->style, b);
        lv_obj_t *sw = lv_switch_create(obj);
        lv_obj_add_flag(sw, LV_OBJ_FLAG_CLICKABLE);
        break;
    }
    default:
        ESP_LOGW(TAG, "unhandled widget type %u", node->type);
        return NULL;
    }

    if (obj == NULL) {
        return NULL;
    }

    if (node->flags & ES_NODE_FLAG_HIDDEN) {
        lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN);
    }
    if (node->flags & ES_NODE_FLAG_DISABLED) {
        lv_obj_clear_flag(obj, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_style_opa(obj, LV_OPA_50, 0);
    }

    /* Attach the event bridge when the node binds tap or long press. */
    if (node->on[ES_EV_TAP].first != NULL || node->on[ES_EV_LONG_PRESS].first != NULL) {
        es_widget_ctx_t *ctx = (es_widget_ctx_t *)calloc(1, sizeof(*ctx));
        if (ctx != NULL) {
            ctx->panel = panel;
            ctx->node = node;
            lv_obj_add_flag(obj, LV_OBJ_FLAG_CLICKABLE);
            lv_obj_add_event_cb(obj, widget_event_cb, LV_EVENT_CLICKED, ctx);
            lv_obj_add_event_cb(obj, widget_event_cb, LV_EVENT_LONG_PRESSED, ctx);
        }
    }

    node->obj = obj;
    return obj;
}

static void render_children(lv_obj_t *parent, es_node_t *first, es_bundle_t *b,
                            echo_screen_t panel)
{
    for (es_node_t *n = first; n != NULL; n = n->next_sibling) {
        render_node(n, parent, b, panel);
    }
}

/* --------------------------------------------------------------- page build */

esp_err_t es_render_page(es_page_t *page, lv_display_t *disp)
{
    if (page == NULL || page->root == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    /* Which panel slot does this build belong to? */
    uint8_t slot = (disp != NULL && disp == echo_ui_display(ECHO_SCREEN_AUX)) ? 1 : 0;
    if (page->built[slot]) {
        return ESP_OK;
    }
    es_bundle_t *b = es_bundle();
    if (b == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    if (disp != NULL) {
        lv_display_set_default(disp);
    }

    /* The root node *is* the screen: its style configures the screen itself and
     * its children become the widgets. */
    lv_obj_t *scr = lv_obj_create(NULL);
    if (scr == NULL) {
        return ESP_ERR_NO_MEM;
    }
    lv_obj_remove_style_all(scr);
    lv_obj_set_layout(scr, LV_LAYOUT_FLEX);
    apply_style(scr, &page->root->style, b);
    apply_flex(scr, &page->root->style);
    if (!page->root->style.bg.set) {
        lv_obj_set_style_bg_color(scr, color_of(&b->theme_bg, lv_color_hex(0x0E1216)), 0);
        lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);
    }

    /* Determine which panel this build belongs to from the display pointer. */
    echo_screen_t panel = slot ? ECHO_SCREEN_AUX : ECHO_SCREEN_MAIN;
    render_children(scr, page->root->first_child, b, panel);

    page->screen[slot] = scr;
    page->built[slot] = true;
    return ESP_OK;
}

void es_render_page_free(es_page_t *page)
{
    if (page == NULL) {
        return;
    }
    for (uint8_t slot = 0; slot < 2; slot++) {
        if (page->screen[slot] != NULL) {
            lv_obj_delete(page->screen[slot]);
            page->screen[slot] = NULL;
        }
        page->built[slot] = false;
    }
}

/* ------------------------------------------------------------- var refresh */

/* Re-render one node's text/value binding, returning true when it changed. */
static bool refresh_node(es_node_t *node, const char *path)
{
    bool changed = false;

    /* Text template. */
    if (node->segments != NULL && node->segment_count > 0) {
        bool references = false;
        for (uint16_t i = 0; i < node->segment_count; i++) {
            if (node->segments[i].path != NULL && strcmp(node->segments[i].path, path) == 0) {
                references = true;
                break;
            }
        }
        if (references) {
            char text[512];
            es_bind_render(node->segments, node->segment_count, text, sizeof(text));
            lv_obj_t *target = node->text_obj != NULL ? node->text_obj : node->obj;
            if (target != NULL) {
                lv_label_set_text(target, text);
                changed = true;
            }
        }
    }

    /* Value template (bar/toggle). */
    if (node->value_segments != NULL && node->value_segment_count > 0) {
        bool references = false;
        for (uint16_t i = 0; i < node->value_segment_count; i++) {
            if (node->value_segments[i].path != NULL &&
                strcmp(node->value_segments[i].path, path) == 0) {
                references = true;
                break;
            }
        }
        if (references && node->obj != NULL && node->type == ES_NODE_BAR) {
            char value[32];
            es_bind_render(node->value_segments, node->value_segment_count, value, sizeof(value));
            lv_bar_set_value(node->obj, atoi(value), LV_ANIM_OFF);
            changed = true;
        }
    }

    for (es_node_t *c = node->first_child; c != NULL; c = c->next_sibling) {
        if (refresh_node(c, path)) {
            changed = true;
        }
    }
    return changed;
}

void es_render_refresh_var(const char *path)
{
    es_bundle_t *b = es_bundle();
    if (b == NULL || path == NULL) {
        return;
    }
    for (uint16_t i = 0; i < b->page_count; i++) {
        if ((!b->pages[i].built[0] && !b->pages[i].built[1]) || b->pages[i].root == NULL) {
            continue;
        }
        refresh_node(b->pages[i].root, path);
    }
}

void es_render_refresh_all(void)
{
    es_bundle_t *b = es_bundle();
    if (b == NULL) {
        return;
    }
    for (uint16_t i = 0; i < b->page_count; i++) {
        if ((!b->pages[i].built[0] && !b->pages[i].built[1]) || b->pages[i].root == NULL) {
            continue;
        }
        for (es_node_t *n = b->pages[i].root->first_child; n != NULL; n = n->next_sibling) {
            refresh_node(n, NULL);
        }
    }
}
