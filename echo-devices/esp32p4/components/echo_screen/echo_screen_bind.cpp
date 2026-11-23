/*
 * Template binding.
 *
 * A text value in the bundle is a template: literal text with `{{path}}`
 * references. It is compiled once at parse time into a segment list so a
 * variable update only re-renders the strings that reference it — no parsing in
 * the render path.
 *
 * Literals and paths are copied out of the source string (the cJSON tree keeps
 * the original, but the substrings inside it are not NUL-terminated), so each
 * segment owns its memory and es_bind_free releases it.
 */

#include <stdlib.h>
#include <string.h>

#include "esp_log.h"

#include "echo_screen_internal.h"

static const char *TAG = "es_bind";

#define ES_SEGMENT_MAX_TEXT 256

/* Copy [start, end) into a fresh NUL-terminated string. */
static char *dup_range(const char *start, const char *end)
{
    size_t len = (size_t)(end - start);
    char  *out = (char *)malloc(len + 1);
    if (out == NULL) {
        return NULL;
    }
    memcpy(out, start, len);
    out[len] = '\0';
    return out;
}

esp_err_t es_bind_compile(const char *source, es_segment_t **out, uint16_t *count)
{
    if (out == NULL || count == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    *out = NULL;
    *count = 0;

    if (source == NULL || source[0] == '\0') {
        return ESP_OK;
    }

    /* Two passes: count the segments, then fill them. */
    uint16_t    segments = 0;
    const char *p = source;
    while (*p != '\0') {
        const char *open = strstr(p, "{{");
        if (open == NULL) {
            segments++;
            break;
        }
        const char *close = strstr(open + 2, "}}");
        if (close == NULL) {
            segments++;
            break;
        }
        if (open > p) {
            segments++; /* literal before the reference */
        }
        segments++; /* the reference itself */
        p = close + 2;
    }

    if (segments == 0) {
        return ESP_OK;
    }
    if (segments > ES_MAX_TEMPLATE_SEGS) {
        ESP_LOGW(TAG, "template has %u segments, limit is %u", segments,
                 ES_MAX_TEMPLATE_SEGS);
        return ESP_ERR_INVALID_SIZE;
    }

    es_segment_t *list = (es_segment_t *)calloc(segments, sizeof(es_segment_t));
    if (list == NULL) {
        return ESP_ERR_NO_MEM;
    }

    uint16_t    i = 0;
    p = source;
    while (*p != '\0' && i < segments) {
        const char *open = strstr(p, "{{");
        if (open == NULL) {
            list[i].text = dup_range(p, p + strlen(p));
            i++;
            break;
        }
        const char *close = strstr(open + 2, "}}");
        if (close == NULL) {
            list[i].text = dup_range(p, p + strlen(p));
            i++;
            break;
        }
        if (open > p) {
            list[i].text = dup_range(p, open);
            i++;
        }
        /* Trim the whitespace inside the braces. */
        const char *ref_start = open + 2;
        const char *ref_end = close;
        while (ref_start < ref_end && (*ref_start == ' ' || *ref_start == '\t')) {
            ref_start++;
        }
        while (ref_end > ref_start && (ref_end[-1] == ' ' || ref_end[-1] == '\t')) {
            ref_end--;
        }
        list[i].path = dup_range(ref_start, ref_end);
        i++;
        p = close + 2;
    }

    *out = list;
    *count = i;
    return ESP_OK;
}

void es_bind_render(const es_segment_t *segments, uint16_t count, char *out, size_t size)
{
    if (out == NULL || size == 0) {
        return;
    }
    out[0] = '\0';
    if (segments == NULL) {
        return;
    }

    size_t used = 0;
    for (uint16_t i = 0; i < count; i++) {
        const char *piece = NULL;
        char        value[ES_SEGMENT_MAX_TEXT];

        if (segments[i].path != NULL) {
            const char *v = echo_screen_var_get(segments[i].path);
            if (v != NULL) {
                piece = v;
            } else {
                /* Unknown variable: leave the reference visible so the bundle
                 * author can see what is missing on the panel. */
                snprintf(value, sizeof(value), "{{%s}}", segments[i].path);
                piece = value;
            }
        } else {
            piece = segments[i].text;
        }

        if (piece == NULL) {
            continue;
        }
        size_t len = strlen(piece);
        if (used + len + 1 > size) {
            len = size - used - 1;
        }
        if (len == 0) {
            break;
        }
        memcpy(out + used, piece, len);
        used += len;
        out[used] = '\0';
    }
}

void es_bind_free(es_segment_t *segments, uint16_t count)
{
    if (segments == NULL) {
        return;
    }
    for (uint16_t i = 0; i < count; i++) {
        free((void *)segments[i].text);
        free((void *)segments[i].path);
    }
    free(segments);
}
