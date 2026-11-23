/*
 * echo_wakeword — "Hey Charlie" wake word detection for the echo-cook device.
 *
 * This component owns the *policy* around wake word detection: audio buffering into
 * fixed 40 ms windows with a 10 ms hop, score smoothing, detection threshold,
 * post-detection cooldown, TTS suppression, and event dispatch on its own task so the
 * ESP-SR AFE task is never blocked.
 *
 * The *model* is pluggable. Two ways to supply it:
 *   1. Call echo_wakeword_attach_engine() with your own engine implementation before
 *      echo_wakeword_init(). This is how a TFLite-Micro "hey_charlie" engine is wired in.
 *   2. Enable CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED in menuconfig, which links the engine
 *      implementation shipped in this component (see README.md).
 *
 * With no engine attached the component still runs (buffering, statistics, VAD-less
 * framing) but never reports a detection — that keeps a build without the trained model
 * green and makes the missing piece obvious in the log.
 *
 * Typical use, from the AFE fetch loop:
 *
 *     echo_wakeword_config_t cfg = ECHO_WAKEWORD_CONFIG_DEFAULT();
 *     cfg.threshold = 0.90f;
 *     ESP_ERROR_CHECK(echo_wakeword_init(&cfg));
 *     echo_wakeword_register_callback(on_wake, NULL);
 *     ...
 *     afe_fetch_result_t *r = afe->fetch(afe);
 *     echo_wakeword_feed((const int16_t *)r->data, r->data_size / sizeof(int16_t));
 */

#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

/* Kconfig options (components/echo_wakeword/Kconfig) are optional when this header is used
 * from a non-IDF build, so every reference below is guarded. */
#if defined(__has_include)
#  if __has_include("sdkconfig.h")
#    include "sdkconfig.h"
#  endif
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* Audio format the whole pipeline works in. The ESP-SR AFE output must match this. */
#define ECHO_WAKEWORD_SAMPLE_RATE_HZ   16000
#define ECHO_WAKEWORD_WINDOW_MS        40     /* analysis window per inference        */
#define ECHO_WAKEWORD_HOP_MS           10     /* advance between inferences           */
#define ECHO_WAKEWORD_WINDOW_SAMPLES   (ECHO_WAKEWORD_SAMPLE_RATE_HZ * ECHO_WAKEWORD_WINDOW_MS / 1000)
#define ECHO_WAKEWORD_HOP_SAMPLES      (ECHO_WAKEWORD_SAMPLE_RATE_HZ * ECHO_WAKEWORD_HOP_MS / 1000)

/* Detection callback. Runs on the component's own task: keep it short and non-blocking,
 * post to a queue or set an event group instead of doing work inline. */
typedef void (*echo_wakeword_cb_t)(void *user_ctx);

/* Model engine interface. Implemented by the TFLite engine (or a mock in tests).
 *
 *   init    : called once from echo_wakeword_init(); return non-zero ESP error on failure.
 *   score   : given one window of ECHO_WAKEWORD_WINDOW_SAMPLES mono samples, return a
 *             detection confidence in [0.0, 1.0]. Must be re-entrant-free (single task).
 *   deinit  : optional, called from echo_wakeword_deinit().
 *
 * The engine must maintain its own streaming feature state between calls; do not
 * re-allocate interpreters per window.
 */
typedef struct {
    esp_err_t (*init)(float threshold);
    float     (*score)(const int16_t *window, size_t samples);
    void      (*deinit)(void);
} echo_wakeword_engine_t;

typedef struct {
    float    threshold;             /* confidence needed to report a detection (0..1)      */
    uint32_t cooldown_ms;           /* ignore detections this long after a detection       */
    uint8_t  consecutive_windows;   /* positive windows required in a row (smoothing)      */
    bool     verbose;               /* log per-window scores (very noisy, debug only)      */
} echo_wakeword_config_t;

/* Threshold and verbosity follow Kconfig when available; the literals are the fallback for
 * non-IDF builds. Cooldown and smoothing are fixed here — they are not product settings. */
#if defined(CONFIG_ECHO_WAKEWORD_DEFAULT_THRESHOLD_PERMILLE)
#  define ECHO_WAKEWORD_DEFAULT_THRESHOLD \
       ((float)CONFIG_ECHO_WAKEWORD_DEFAULT_THRESHOLD_PERMILLE / 1000.0f)
#else
#  define ECHO_WAKEWORD_DEFAULT_THRESHOLD 0.90f
#endif

#if defined(CONFIG_ECHO_WAKEWORD_VERBOSE_SCORES)
#  define ECHO_WAKEWORD_DEFAULT_VERBOSE true
#else
#  define ECHO_WAKEWORD_DEFAULT_VERBOSE false
#endif

#define ECHO_WAKEWORD_CONFIG_DEFAULT()                                  \
    (echo_wakeword_config_t) {                                          \
        .threshold = ECHO_WAKEWORD_DEFAULT_THRESHOLD,                   \
        .cooldown_ms = 1000,                                            \
        .consecutive_windows = 2,                                       \
        .verbose = ECHO_WAKEWORD_DEFAULT_VERBOSE,                       \
    }

typedef struct {
    uint32_t windows_scored;
    uint32_t detections;
    uint32_t suppressed_windows;
    float    last_score;
} echo_wakeword_stats_t;

/* Register the model engine. Must be called before echo_wakeword_init().
 * Returns ESP_ERR_INVALID_STATE if the component is already initialised. */
esp_err_t echo_wakeword_attach_engine(const echo_wakeword_engine_t *engine);

/* Initialise buffers and start the dispatch task. Safe to call once; a second call
 * returns ESP_ERR_INVALID_STATE. If no engine is attached the component logs a warning
 * and stays in "buffer only" mode. */
esp_err_t echo_wakeword_init(const echo_wakeword_config_t *config);

/* Replace the configuration (threshold, cooldown, smoothing) at runtime. Used by the
 * server's setWakeUpWordAccuracy command. Threshold is clamped to [0.0, 1.0]. */
esp_err_t echo_wakeword_set_threshold(float threshold);

/* Register/replace the detection callback. May be called before or after init. */
esp_err_t echo_wakeword_register_callback(echo_wakeword_cb_t cb, void *user_ctx);

/* Feed 16 kHz mono PCM. Called from the AFE task. Never blocks on inference longer than
 * one window; detection events are queued to the dispatch task. */
esp_err_t echo_wakeword_feed(const int16_t *pcm, size_t samples);

/* Suppress detection while the device is playing its own TTS, and for a short tail after
 * playback ends (the AEC reduces but does not eliminate self-triggering). */
void echo_wakeword_set_suppressed(bool suppressed);

/* Query counters for diagnostics and for the "wake word accuracy" tuning loop. */
void echo_wakeword_get_stats(echo_wakeword_stats_t *out);

/* True when an engine is attached and initialised. */
bool echo_wakeword_is_ready(void);

/* Stop the dispatch task and release buffers. */
void echo_wakeword_deinit(void);

#ifdef __cplusplus
}
#endif
