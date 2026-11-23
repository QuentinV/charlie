/*
 * echo_wakeword — streaming wake word policy layer ("Hey Charlie").
 *
 * Design notes that matter:
 *
 *  - The model engine is called for EVERY 40 ms window, even while detection is
 *    suppressed or in cooldown. The engine carries streaming feature state; skipping
 *    windows would corrupt it. Suppression only gates the *reporting*, not the scoring.
 *  - The window history is a ring buffer. After each 10 ms hop it is linearised into a
 *    scratch buffer and scored. 640 int16 copies per 10 ms is negligible.
 *  - feed() is called from the ESP-SR AFE task. It must never block on user code, so a
 *    detection is posted to a queue and the callback runs on this component's own task.
 *  - With no engine attached the component still buffers and counts windows. It never
 *    reports a detection, which keeps builds without the trained model compiling and
 *    makes the omission visible in the log.
 */

#include "echo_wakeword.h"

#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "echo_wakeword";

#define WW_TASK_STACK      3072
#define WW_TASK_PRIO       5
#define WW_TASK_NAME       "echo_wakeword"
#define WW_EVENT_QUEUE_LEN 4

static struct {
    bool                     initialised;
    bool                     suppressed;
    bool                     engine_ready;
    const echo_wakeword_engine_t *engine;
    echo_wakeword_cb_t       callback;
    void                    *callback_ctx;
    echo_wakeword_config_t   config;
    echo_wakeword_stats_t    stats;

    /* Ring buffer holding the last ECHO_WAKEWORD_WINDOW_SAMPLES mono samples. */
    int16_t                  history[ECHO_WAKEWORD_WINDOW_SAMPLES];
    size_t                   write_idx;      /* next slot to write                        */
    size_t                   filled;         /* valid samples in history (caps at WINDOW) */
    size_t                   since_hop;      /* samples accumulated since last score      */
    int16_t                  window[ECHO_WAKEWORD_WINDOW_SAMPLES];

    uint8_t                  consecutive;    /* positive windows in a row                 */
    int64_t                  cooldown_until_us;

    QueueHandle_t            event_queue;
    SemaphoreHandle_t        lock;
    TaskHandle_t             task;
} s_ww;

/* ------------------------------------------------------------------------- */
/* helpers                                                                   */
/* ------------------------------------------------------------------------- */

static inline bool cooldown_active(void)
{
    return esp_timer_get_time() < s_ww.cooldown_until_us;
}

static void dispatch_task(void *arg)
{
    (void)arg;
    uint8_t token;
    while (true) {
        if (xQueueReceive(s_ww.event_queue, &token, portMAX_DELAY) != pdTRUE) {
            continue;
        }
        echo_wakeword_cb_t cb;
        void *ctx;
        xSemaphoreTake(s_ww.lock, portMAX_DELAY);
        cb  = s_ww.callback;
        ctx = s_ww.callback_ctx;
        xSemaphoreGive(s_ww.lock);

        if (cb) {
            cb(ctx);
        }
    }
}

/* Copy the ring buffer into s_ww.window in chronological order. Caller holds the lock. */
static void linearise_window(void)
{
    const size_t n = ECHO_WAKEWORD_WINDOW_SAMPLES;
    if (s_ww.filled < n) {
        /* Not enough audio yet; leave the window as-is (engine will see stale data). */
        return;
    }
    const size_t tail = n - s_ww.write_idx;    /* samples from write_idx to end of ring */
    memcpy(s_ww.window, &s_ww.history[s_ww.write_idx], tail * sizeof(int16_t));
    if (s_ww.write_idx > 0) {
        memcpy(&s_ww.window[tail], s_ww.history, s_ww.write_idx * sizeof(int16_t));
    }
}

static void score_window(void)
{
    float score = 0.0f;

    /* Snapshot config and engine under the lock, then release before running the model so
     * a slow inference cannot block set_threshold() for long. The engine itself is only
     * ever called from this task (feed), so no extra serialisation is needed. */
    xSemaphoreTake(s_ww.lock, portMAX_DELAY);
    const echo_wakeword_engine_t *engine = s_ww.engine;
    const bool engine_ready = s_ww.engine_ready;
    const bool suppressed = s_ww.suppressed;
    const bool verbose = s_ww.config.verbose;
    const float threshold = s_ww.config.threshold;
    const uint8_t need_consecutive = s_ww.config.consecutive_windows;
    const uint32_t cooldown_ms = s_ww.config.cooldown_ms;
    linearise_window();
    xSemaphoreGive(s_ww.lock);

    s_ww.stats.windows_scored++;

    if (!engine_ready || !engine || !engine->score) {
        return;    /* buffer-only mode */
    }

    score = engine->score(s_ww.window, ECHO_WAKEWORD_WINDOW_SAMPLES);
    s_ww.stats.last_score = score;

    if (verbose) {
        ESP_LOGD(TAG, "score %.3f (threshold %.3f)", score, threshold);
    }

    const bool positive = score >= threshold;
    s_ww.consecutive = positive ? (uint8_t)(s_ww.consecutive + 1) : 0;

    if (s_ww.consecutive < need_consecutive) {
        return;
    }
    s_ww.consecutive = 0;

    if (suppressed || cooldown_active()) {
        s_ww.stats.suppressed_windows++;
        ESP_LOGD(TAG, "detection suppressed (tts=%d cooldown=%d)", suppressed, cooldown_active());
        return;
    }

    s_ww.cooldown_until_us = esp_timer_get_time() + (int64_t)cooldown_ms * 1000;
    s_ww.stats.detections++;
    ESP_LOGI(TAG, "wake word detected (score %.3f)", score);

    const uint8_t token = 1;
    if (xQueueSend(s_ww.event_queue, &token, 0) != pdTRUE) {
        ESP_LOGW(TAG, "event queue full, detection dropped");
    }
}

/* ------------------------------------------------------------------------- */
/* public API                                                                */
/* ------------------------------------------------------------------------- */

esp_err_t echo_wakeword_attach_engine(const echo_wakeword_engine_t *engine)
{
    if (engine == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (s_ww.initialised) {
        return ESP_ERR_INVALID_STATE;
    }
    s_ww.engine = engine;
    return ESP_OK;
}

esp_err_t echo_wakeword_init(const echo_wakeword_config_t *config)
{
    if (s_ww.initialised) {
        return ESP_ERR_INVALID_STATE;
    }

    /* Preserve an engine attached before init; everything else starts clean. */
    const echo_wakeword_engine_t *engine = s_ww.engine;
    const bool suppressed = s_ww.suppressed;
    memset(&s_ww, 0, sizeof(s_ww));
    s_ww.engine = engine;
    s_ww.suppressed = suppressed;

    s_ww.config = config ? *config : ECHO_WAKEWORD_CONFIG_DEFAULT();
    if (s_ww.config.threshold < 0.0f) s_ww.config.threshold = 0.0f;
    if (s_ww.config.threshold > 1.0f) s_ww.config.threshold = 1.0f;
    if (s_ww.config.consecutive_windows == 0) s_ww.config.consecutive_windows = 1;

    s_ww.lock = xSemaphoreCreateMutex();
    s_ww.event_queue = xQueueCreate(WW_EVENT_QUEUE_LEN, sizeof(uint8_t));
    if (s_ww.lock == NULL || s_ww.event_queue == NULL) {
        goto fail;
    }

    if (s_ww.engine && s_ww.engine->init) {
        esp_err_t err = s_ww.engine->init(s_ww.config.threshold);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "engine init failed: %s", esp_err_to_name(err));
            goto fail;
        }
        s_ww.engine_ready = true;
        ESP_LOGI(TAG, "engine attached, threshold %.2f", s_ww.config.threshold);
    } else {
        ESP_LOGW(TAG, "no engine attached - buffering only, detections disabled");
    }

    if (xTaskCreate(dispatch_task, WW_TASK_NAME, WW_TASK_STACK, NULL, WW_TASK_PRIO,
                    &s_ww.task) != pdPASS) {
        ESP_LOGE(TAG, "task create failed");
        if (s_ww.engine && s_ww.engine->deinit) s_ww.engine->deinit();
        goto fail;
    }

    s_ww.initialised = true;
    return ESP_OK;

fail:
    if (s_ww.lock)        { vSemaphoreDelete(s_ww.lock); s_ww.lock = NULL; }
    if (s_ww.event_queue) { vQueueDelete(s_ww.event_queue); s_ww.event_queue = NULL; }
    s_ww.engine_ready = false;
    return ESP_ERR_NO_MEM;
}

esp_err_t echo_wakeword_set_threshold(float threshold)
{
    if (threshold < 0.0f) threshold = 0.0f;
    if (threshold > 1.0f) threshold = 1.0f;
    if (!s_ww.initialised) {
        return ESP_ERR_INVALID_STATE;
    }
    xSemaphoreTake(s_ww.lock, portMAX_DELAY);
    s_ww.config.threshold = threshold;
    xSemaphoreGive(s_ww.lock);
    ESP_LOGI(TAG, "threshold set to %.2f", threshold);
    return ESP_OK;
}

esp_err_t echo_wakeword_register_callback(echo_wakeword_cb_t cb, void *user_ctx)
{
    if (!s_ww.initialised) {
        return ESP_ERR_INVALID_STATE;
    }
    xSemaphoreTake(s_ww.lock, portMAX_DELAY);
    s_ww.callback = cb;
    s_ww.callback_ctx = user_ctx;
    xSemaphoreGive(s_ww.lock);
    return ESP_OK;
}

esp_err_t echo_wakeword_feed(const int16_t *pcm, size_t samples)
{
    if (pcm == NULL || samples == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!s_ww.initialised) {
        return ESP_ERR_INVALID_STATE;
    }

    xSemaphoreTake(s_ww.lock, portMAX_DELAY);
    for (size_t i = 0; i < samples; i++) {
        s_ww.history[s_ww.write_idx] = pcm[i];
        s_ww.write_idx = (s_ww.write_idx + 1) % ECHO_WAKEWORD_WINDOW_SAMPLES;
        if (s_ww.filled < ECHO_WAKEWORD_WINDOW_SAMPLES) {
            s_ww.filled++;
        }
        s_ww.since_hop++;
        if (s_ww.since_hop >= ECHO_WAKEWORD_HOP_SAMPLES &&
            s_ww.filled == ECHO_WAKEWORD_WINDOW_SAMPLES) {
            s_ww.since_hop = 0;
            /* score_window() takes the lock itself, so release it first. The AFE task
             * therefore blocks for one inference at most, once per 10 ms hop. */
            xSemaphoreGive(s_ww.lock);
            score_window();
            xSemaphoreTake(s_ww.lock, portMAX_DELAY);
        }
    }
    xSemaphoreGive(s_ww.lock);
    return ESP_OK;
}

void echo_wakeword_set_suppressed(bool suppressed)
{
    if (!s_ww.initialised) {
        s_ww.suppressed = suppressed;   /* allow setting before init */
        return;
    }
    xSemaphoreTake(s_ww.lock, portMAX_DELAY);
    s_ww.suppressed = suppressed;
    xSemaphoreGive(s_ww.lock);
}

void echo_wakeword_get_stats(echo_wakeword_stats_t *out)
{
    if (out == NULL) {
        return;
    }
    xSemaphoreTake(s_ww.lock, portMAX_DELAY);
    *out = s_ww.stats;
    xSemaphoreGive(s_ww.lock);
}

bool echo_wakeword_is_ready(void)
{
    return s_ww.engine_ready;
}

void echo_wakeword_deinit(void)
{
    if (!s_ww.initialised) {
        return;
    }
    s_ww.initialised = false;

    /* Stop feeding first; callers must ensure no feed() call is in flight. */
    if (s_ww.task) {
        vTaskDelete(s_ww.task);
        s_ww.task = NULL;
    }
    if (s_ww.engine && s_ww.engine->deinit) {
        s_ww.engine->deinit();
    }
    s_ww.engine_ready = false;
    if (s_ww.lock)        { vSemaphoreDelete(s_ww.lock); s_ww.lock = NULL; }
    if (s_ww.event_queue) { vQueueDelete(s_ww.event_queue); s_ww.event_queue = NULL; }
}
