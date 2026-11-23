/*
 * echo_wakeword_tflite — handle for the TFLite-Micro "Hey Charlie" engine.
 *
 * The engine lives in engines/tflite_engine.cpp and is only compiled when
 * CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED is set. This header exists so application code can
 * include it unconditionally and attach the engine without hand-written externs:
 *
 *     #include "echo_wakeword.h"
 *     #include "echo_wakeword_tflite.h"
 *
 *     #if CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED
 *         ESP_ERROR_CHECK(echo_wakeword_attach_engine(&echo_wakeword_tflite_engine));
 *     #endif
 *     ESP_ERROR_CHECK(echo_wakeword_init(&cfg));
 *
 * Note: when the engine is enabled but the model partition is missing or malformed,
 * engine init fails and echo_wakeword_init() currently propagates that failure (it does
 * not degrade to buffer-only mode). See engines/README.md, "Known integration issues".
 */

#pragma once

#include "echo_wakeword.h"

#if defined(CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED)

#ifdef __cplusplus
extern "C" {
#endif

/* Streaming mel-spectrogram frontend + TFLite-Micro interpreter. Stateless API: all state
 * is internal to the engine, initialised by init() and released by deinit(). */
extern const echo_wakeword_engine_t echo_wakeword_tflite_engine;

#ifdef __cplusplus
}
#endif

#endif /* CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED */
