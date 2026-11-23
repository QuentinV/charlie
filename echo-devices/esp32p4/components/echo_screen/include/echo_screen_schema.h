/*
 * Echo-Cook screen bundle contract — device side of `ui.bundle/1`.
 *
 * This header mirrors the enums and limits of the JSON contract that Charlie
 * owns. The authoritative definition lives in the Charlie repo:
 *
 *     charlie/nodejs-apis/src/echo/ui/schema.ts
 *
 * and its generated JSON Schema is committed next to this project as
 * `docs/ui-bundle.schema.json` (example bundle: `docs/ui-bundle.example.json`).
 * When a value changes there, change it here too — the parser in
 * echo_screen_bundle.cpp validates against these constants, so a mismatch shows
 * up as a rejected bundle on the panel rather than as a silent misrender.
 *
 * A bundle is the whole UI of one device: the pages for the 10.1" DSI panel and
 * the 3.5" SPI panel, the theme, and the variable declarations the device
 * resolves itself. The device pulls it over HTTP, renders it with LVGL and runs
 * the actions locally; only `call` actions reach Charlie.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Bundle schema version this firmware understands. */
#define ES_SCHEMA_VERSION 1

/** Limits. Mirror of UI_LIMITS in schema.ts. */
#define ES_MAX_BUNDLE_BYTES   (192 * 1024)
#define ES_MAX_PAGES          32
#define ES_MAX_DEPTH          8
#define ES_MAX_NODES_PER_PAGE 256
#define ES_MAX_VARS           64
#define ES_MAX_ACTION_DEPTH   4
#define ES_MAX_TEMPLATE_SEGS  16

/** Widget types. Order is part of the wire format: never reorder. */
typedef enum {
    ES_NODE_SCREEN = 0, /*!< Root container; one per page.                     */
    ES_NODE_ROW,        /*!< Horizontal flex container.                        */
    ES_NODE_COL,        /*!< Vertical flex container.                          */
    ES_NODE_SCROLL,     /*!< Flex container that scrolls (scrollDir).          */
    ES_NODE_TEXT,       /*!< Label bound to a template.                        */
    ES_NODE_BUTTON,     /*!< Tap target with a label.                          */
    ES_NODE_IMAGE,      /*!< Image from /storage or an http(s) url.            */
    ES_NODE_DIVIDER,    /*!< 1 px rule.                                        */
    ES_NODE_BAR,        /*!< Progress bar bound to a value.                    */
    ES_NODE_TOGGLE,     /*!< On/off control bound to a bool variable.          */
    ES_NODE_LIST,       /*!< Scrollable list container.                        */
    ES_NODE_MAX
} es_node_type_t;

/** Flex direction of a container. */
typedef enum {
    ES_FLEX_NONE = 0,
    ES_FLEX_ROW,
    ES_FLEX_COLUMN,
} es_flex_t;

/** Text alignment inside a text-bearing widget. */
typedef enum {
    ES_ALIGN_LEFT = 0,
    ES_ALIGN_CENTER,
    ES_ALIGN_RIGHT,
} es_align_t;

/** Vertical alignment of children inside a container. */
typedef enum {
    ES_VALIGN_TOP = 0,
    ES_VALIGN_MIDDLE,
    ES_VALIGN_BOTTOM,
} es_valign_t;

/** Scroll direction of a scroll/list container. */
typedef enum {
    ES_SCROLL_NONE = 0,
    ES_SCROLL_VERTICAL,
    ES_SCROLL_HORIZONTAL,
} es_scroll_dir_t;

/** Variable kinds. */
typedef enum {
    ES_VAR_LOCAL = 0, /*!< Provider registered on the device.               */
    ES_VAR_REMOTE,    /*!< Resolved by Charlie and polled on its ttl.       */
} es_var_kind_t;

/** Variable value types, used for formatting. */
typedef enum {
    ES_VAR_STRING = 0,
    ES_VAR_INT,
    ES_VAR_FLOAT,
    ES_VAR_BOOL,
} es_var_type_t;

/** Event sources a widget or page can bind actions to. */
typedef enum {
    ES_EV_TAP = 0,
    ES_EV_LONG_PRESS,
    ES_EV_ENTER,
    ES_EV_LEAVE,
    ES_EV_INTERVAL,
    ES_EV_VAR,
    ES_EV_GESTURE,
    ES_EV_MAX
} es_event_t;

/** Gestures an action can bind to. Names match the JSON keys. */
typedef enum {
    ES_GESTURE_SWIPE_LEFT = 0,
    ES_GESTURE_SWIPE_RIGHT,
    ES_GESTURE_SWIPE_UP,
    ES_GESTURE_SWIPE_DOWN,
    ES_GESTURE_FORWARD,
    ES_GESTURE_BACKWARD,
    ES_GESTURE_MAX
} es_gesture_t;

/** Action verbs. Order is part of the wire format: never reorder. */
typedef enum {
    ES_ACTION_NAVIGATE = 0,
    ES_ACTION_BACK,
    ES_ACTION_SET_VAR,
    ES_ACTION_TOGGLE_VAR,
    ES_ACTION_SHOW,
    ES_ACTION_HIDE,
    ES_ACTION_ENABLE,
    ES_ACTION_DISABLE,
    ES_ACTION_WAIT,
    ES_ACTION_IF,
    ES_ACTION_CALL,
    ES_ACTION_RELOAD,
    ES_ACTION_MAX
} es_action_verb_t;

/** Comparison operators of an `if` condition. */
typedef enum {
    ES_OP_EQ = 0, /*!< == */
    ES_OP_NE,     /*!< != */
    ES_OP_GT,     /*!< >  */
    ES_OP_LT,     /*!< <  */
    ES_OP_GE,     /*!< >= */
    ES_OP_LE,     /*!< <= */
    ES_OP_CONTAINS,
    ES_OP_EXISTS,
} es_condition_op_t;

/** Displays a page can target. Bit flags so a page can serve both panels. */
#define ES_TARGET_MAIN 0x01
#define ES_TARGET_AUX  0x02

/** Font sizes bundled with the firmware (echo_font_*). */
#define ES_FONT_12 12
#define ES_FONT_16 16
#define ES_FONT_20 20
#define ES_FONT_28 28
#define ES_FONT_40 40
#define ES_FONT_56 56

#ifdef __cplusplus
}
#endif
