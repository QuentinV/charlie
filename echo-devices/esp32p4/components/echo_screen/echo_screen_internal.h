/*
 * Internal model of a parsed screen bundle.
 *
 * The bundle's cJSON tree is kept alive in PSRAM for as long as the bundle is
 * loaded; every `es_*` structure below points into it rather than copying
 * strings. A page build is therefore a pure pointer walk, and a variable update
 * only touches the widgets bound to that variable.
 *
 * Nothing in this header is public: echo_screen.h is the only API the rest of
 * the firmware sees.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "cJSON.h"
#include "lvgl.h"

#include "esp_err.h"

#include "echo_events.h"
#include "echo_screen.h"
#include "echo_screen_schema.h"

/* ---------------------------------------------------------------- constants */

/** Longest variable path the store keeps, including the NUL. */
#ifndef ES_VAR_PATH_MAX
#define ES_VAR_PATH_MAX 64
#endif

/** Longest variable value the store keeps, including the NUL. */
#ifndef ES_VAR_VALUE_MAX
#define ES_VAR_VALUE_MAX 96
#endif

/* ------------------------------------------------------------------ colours */

/** A resolved paint: RGB plus alpha, or "no colour" when the key was absent. */
typedef struct {
    bool    set;
    uint8_t r, g, b, a;
} es_paint_t;

/* ------------------------------------------------------------------- style */

typedef struct {
    es_flex_t       flex;
    es_align_t      align;
    es_valign_t     valign;
    es_scroll_dir_t scroll_dir;

    int16_t gap;
    int16_t pad;
    int16_t pad_x;
    int16_t pad_y;

    uint8_t grow; /* 0 or 1 */

    /* Sizes: negative = "content". Percent is stored in w_pct / h_pct. */
    int16_t w;
    int16_t h;
    uint8_t w_pct;
    uint8_t h_pct;

    es_paint_t bg;
    es_paint_t color;
    es_paint_t border_color;
    uint8_t    border_w;
    uint8_t    radius;
    uint8_t    opacity; /* 0 means "unset" -> 255 */

    uint8_t font_size; /* one of ES_FONT_*; 0 = default */
    uint8_t precision; /* float formatting, 0..4 */
} es_style_t;

/* ---------------------------------------------------------------- actions */

typedef struct es_action es_action_t;

/** An `if` condition: `<path> <op> <value>`. */
typedef struct {
    const char *path;
    uint8_t     op;    /* es_condition_op_t */
    const char *value; /* literal, NULL for exists */
} es_condition_t;

/** An event binding: one action chain per event source. */
typedef struct {
    es_action_t   *first;
    uint16_t       interval_ms; /* for ES_EV_INTERVAL */
    const char    *var_path;    /* for ES_EV_VAR */
    es_condition_t var_when;    /* optional guard for ES_EV_VAR */
} es_event_binding_t;

struct es_action {
    es_action_t   *next;      /* next in the same list */
    uint8_t        type;      /* es_action_t verb */
    const char    *target;    /* page id / widget id / var path / action name */
    const char    *value;     /* setVar value / literal */
    const cJSON   *params;    /* call: params object, points into the tree */
    uint16_t       wait_ms;
    es_condition_t cond;      /* for ES_ACTION_IF */
    es_action_t   *then_list; /* for ES_ACTION_IF */
    es_action_t   *else_list; /* for ES_ACTION_IF */
};

/* ----------------------------------------------------------------- widgets */

/** A template segment: literal text or a `{{path}}` reference. */
typedef struct {
    const char *text; /* literal text (owned by the cJSON tree) */
    const char *path; /* variable path, or NULL for a literal */
} es_segment_t;

typedef struct es_node es_node_t;

struct es_node {
    uint8_t     type;  /* es_node_type_t */
    uint16_t    flags; /* es_node_flag_t */
    const char *id;
    const char *text;  /* raw template source (text/label) */
    const char *src;   /* image source */
    const char *value; /* raw template source for bar/toggle */

    es_segment_t *segments; /* compiled text template */
    uint16_t      segment_count;
    es_segment_t *value_segments;
    uint16_t      value_segment_count;

    es_style_t         style;
    es_event_binding_t on[ES_EV_MAX];

    es_node_t *first_child;
    es_node_t *next_sibling;

    /* Runtime: the LVGL object this node produced (NULL until rendered). */
    lv_obj_t *obj;
    lv_obj_t *text_obj; /* label inside a button/toggle */
};

/** Node flags. */
#define ES_NODE_FLAG_HIDDEN   0x01
#define ES_NODE_FLAG_DISABLED 0x02

/* -------------------------------------------------------------------- page */

typedef struct {
    const char *id;
    uint8_t     targets; /* ES_TARGET_* */
    const char *title;
    es_node_t  *root;
    es_event_binding_t on[ES_EV_MAX];

    /* Runtime: one screen per panel, so a page can serve both displays at once.
     * Index 0 is ECHO_SCREEN_MAIN, index 1 is ECHO_SCREEN_AUX. */
    bool      built[2];
    lv_obj_t *screen[2];
} es_page_t;

/* ---------------------------------------------------------------- document */

typedef struct {
    uint32_t rev;
    char     hash[65];
    uint8_t  targets_default[2]; /* [main, aux] -> page index, 0xFF = none */

    es_page_t *pages;
    uint16_t   page_count;

    /* Declared variables: path -> kind/ttl/type. */
    struct {
        const char *path;
        uint8_t     kind; /* es_var_kind_t */
        uint8_t     type; /* es_var_type_t */
        uint32_t    ttl_ms;
    } vars[ES_MAX_VARS];
    uint16_t var_count;

    /* Theme paints resolved from the bundle. */
    es_paint_t theme_bg;
    es_paint_t theme_surface;
    es_paint_t theme_text;
    es_paint_t theme_muted;
    es_paint_t theme_accent;
    uint8_t    theme_radius;

    /* The retained cJSON tree (owned; freed by es_bundle_free). */
    cJSON *json;
} es_bundle_t;

/* ------------------------------------------------------------ module state */

/** Parsed bundle, or NULL when none is loaded. */
es_bundle_t *es_bundle(void);

/** Replace the loaded bundle (takes ownership of @p bundle). */
void es_bundle_set(es_bundle_t *bundle);

/**
 * @brief Hand a freshly parsed bundle to the UI task (thread-safe).
 *
 * Called from the fetch task. The bundle is not rendered here: the service hook
 * frees the current widgets, swaps the tree and shows the default pages on the
 * next UI-task iteration. Takes ownership of @p bundle.
 */
esp_err_t es_bundle_install(es_bundle_t *bundle);

/** Free a bundle and its cJSON tree. */
void es_bundle_free(es_bundle_t *bundle);

/* --------------------------------------------------------------- parsing */

/** Parse a JSON document into a bundle. Returns NULL on failure (logs why). */
es_bundle_t *es_bundle_parse(const char *json, size_t len);

/* ------------------------------------------------------------- rendering */

/** Build a page's widget tree into a fresh LVGL screen. */
esp_err_t es_render_page(es_page_t *page, lv_display_t *disp);

/** Free a page's widgets and screen. */
void es_render_page_free(es_page_t *page);

/** Re-apply every binding that references @p path. */
void es_render_refresh_var(const char *path);

/** Re-apply all bindings (used after a bundle swap). */
void es_render_refresh_all(void);

/* --------------------------------------------------------------- binding */

/** Compile a template string into segments; returns ESP_OK on success. */
esp_err_t es_bind_compile(const char *source, es_segment_t **out, uint16_t *count);

/** Render a compiled template into @p out. */
void es_bind_render(const es_segment_t *segments, uint16_t count, char *out, size_t size);

/** Free a compiled template. */
void es_bind_free(es_segment_t *segments, uint16_t count);

/* --------------------------------------------------------------- actions */

/** Execute an action chain on a panel. */
void es_actions_run(es_action_t *first, echo_screen_t panel, const char *page_id);

/** Queue an action chain for the UI task (thread-safe). */
esp_err_t es_actions_post(es_action_t *first, echo_screen_t panel, const char *page_id);

/** Drain the action queue. Called from the service hook on the UI task. */
void es_actions_service(void);

/** Switch a panel to a page (runs on the UI task, owns the page stack). */
esp_err_t es_navigate_internal(echo_screen_t panel, const char *page_id);

/** Pop the page stack for a panel. */
esp_err_t es_navigate_back(echo_screen_t panel);

/** Show a page by index on a panel and push it on the stack (UI task only). */
esp_err_t es_actions_show(echo_screen_t panel, uint8_t page_index);

/** Move through the pages this panel targets by @p delta (+1 next, -1 prev). */
esp_err_t es_actions_step(echo_screen_t panel, int delta);

/** Forget the page stack of a panel (used when the bundle is swapped). */
void es_actions_reset(echo_screen_t panel);

/** Page index currently shown on a panel, or 0xFF when none. */
uint8_t es_actions_current(echo_screen_t panel);

/** Queue a page step (built-in gesture default) for the UI task. */
esp_err_t es_actions_post_step(echo_screen_t panel, int delta);

/* --------------------------------------------------------------- variables */

/** Register the built-in `core.*` providers. */
void es_vars_register_builtins(void);

/** Refresh local variables whose ttl elapsed. Called from the service hook. */
void es_vars_tick(void);

/** Mark every `external.*` variable stale (offline) or fresh. */
void es_vars_mark_remote_stale(bool stale);

/** Declare a variable carried by the bundle (called by the parser). */
void es_vars_declare(const char *path, uint8_t kind, uint8_t type, uint32_t ttl_ms);

/**
 * @brief Store a value fetched from Charlie (thread-safe, no LVGL access).
 *
 * Called from the fetch task; the widgets bound to @p path are refreshed on the
 * next service-hook iteration. @p stale dims the value when the server could not
 * be reached.
 */
void es_vars_set_remote(const char *path, const char *value, bool stale);

/** Build the list of `external.*` paths whose ttl elapsed. Returns the count. */
size_t es_vars_due_remote(const char **paths, size_t max);

/** Format a variable value for display (applies precision for floats). */
void es_vars_format(const char *path, uint8_t type, uint8_t precision, char *out, size_t size);

/* ------------------------------------------------------------------ fetch */

/** Start the fetch task. */
esp_err_t es_fetch_start(void);

/** Wake the fetch task to poll now. */
void es_fetch_wake(void);

/** Queue a `call` action to POST to Charlie (thread-safe). */
void es_fetch_post_action(const char *action, const cJSON *params);

/** Ask the fetch task to refresh the given remote variable paths. */
void es_fetch_request_vars(const char *const *paths, size_t count);

/* ------------------------------------------------------------------- util */

/** Convert `#RRGGBB` / `#RRGGBBAA` into a paint. */
bool es_parse_color(const char *s, es_paint_t *out);

/** Resolve a `theme.*` token against the bundle's theme. */
bool es_resolve_paint(es_bundle_t *b, const char *s, es_paint_t *out);
