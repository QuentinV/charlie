# echo_wakeword

Wake word detection layer for the echo-cook device. The phrase is **"Hey Charlie"**.

This component does not contain a model. It provides the streaming policy that a model plugs
into: 40 ms windows with a 10 ms hop, confidence threshold, consecutive-window smoothing,
cooldown, TTS suppression, and event dispatch on its own task so the ESP-SR AFE task is never
blocked.

See `docs/wake-word-training.md` for how the "Hey Charlie" model is produced.

## What runs where

| Piece | Responsibility |
|---|---|
| ESP-SR AFE (`afe->fetch()`) | AEC, beamforming, noise suppression; outputs 16 kHz mono PCM |
| `echo_wakeword_feed()` | Ring buffers PCM, slices windows, calls the engine, applies policy |
| Engine (`echo_wakeword_engine_t`) | Model-specific: features + TFLite inference → confidence 0..1 |
| `echo_wakeword` dispatch task | Runs your callback; post to a queue, do not block |

The engine is called for **every** window, even while suppressed or in cooldown, because it
carries streaming feature state. Suppression only gates reporting.

## Wiring it up

```c
#include "echo_wakeword.h"

static void on_wake(void *ctx)
{
    /* Short: set a flag, notify a task, or post an event. Do not start audio here. */
    xEventGroupSetBits(g_app_events, APP_EVENT_WAKE);
}

void app_main(void)
{
    /* ... NVS, display, audio init ... */

    echo_wakeword_config_t cfg = ECHO_WAKEWORD_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(echo_wakeword_init(&cfg));
    ESP_ERROR_CHECK(echo_wakeword_register_callback(on_wake, NULL));

    /* In the AFE fetch loop: */
    /* afe_fetch_result_t *r = afe->fetch(afe);
       if (r && r->data_size > 0) {
           echo_wakeword_feed((const int16_t *)r->data, r->data_size / sizeof(int16_t));
       } */

    /* While TTS plays, gate reporting: */
    /* echo_wakeword_set_suppressed(true);  ... playback ...  echo_wakeword_set_suppressed(false); */
}
```

Protocol integration: the server's `setWakeUpWordAccuracy` command maps to
`echo_wakeword_set_threshold()`; a detection triggers the same WS sequence as the S3 firmware
(`"start"` → PCM up → `"end"`).

## Attaching the model

### Option A — engine implementation file (recommended)

1. Train and export `hey_charlie.tflite` (see `docs/wake-word-training.md`).
2. Implement `echo_wakeword_engine_t` in `engines/tflite_engine.cpp`:

```cpp
static esp_err_t engine_init(float threshold);
static float     engine_score(const int16_t *window, size_t samples);
static void      engine_deinit(void);

extern "C" const echo_wakeword_engine_t echo_wakeword_tflite_engine = {
    .init = engine_init, .score = engine_score, .deinit = engine_deinit,
};
```

3. Add the dependencies to `src/idf_component.yml`:

```yaml
dependencies:
  espressif/esp-sr: "^2.6.0"
  espressif/esp-tflite-micro: "^1.3.0"
```

4. Enable `CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED` in menuconfig. The component CMakeLists fails
   the build with an explicit message if the engine file is missing.
5. Call `echo_wakeword_attach_engine(&echo_wakeword_tflite_engine)` **before**
   `echo_wakeword_init()`.

### Option B — engine supplied by the application

Implement the three function pointers anywhere in your app (even in `src/`) and call
`echo_wakeword_attach_engine()` before init. No Kconfig changes needed. Useful for a mock engine
in host tests or while the model is still being trained.

## Model delivery

* **Flash partition (default):** `model` partition, loaded with `esp_partition_mmap`, updated by
  OTA without rebuilding the app.
* **Embedded blob:** add
  `board_build.embed_files = components/echo_wakeword/models/hey_charlie.tflite` to
  `platformio.ini` and read the `_binary_hey_charlie_tflite_start` / `_end` symbols.

## Buffer-only mode

With no engine attached the component logs one warning at init and keeps buffering. `feed()`
returns `ESP_OK`, `echo_wakeword_is_ready()` returns `false`, and no detection is ever reported.
This is deliberate: the DSI/display bring-up build stays green before the model exists.

## Tuning knobs

| Setting | Where | Notes |
|---|---|---|
| Threshold | `cfg.threshold` / `echo_wakeword_set_threshold()` / Kconfig | 0.90 default; server can override |
| Cooldown | `cfg.cooldown_ms` | 1000 ms default; prevents double triggers |
| Smoothing | `cfg.consecutive_windows` | 2 default; raise to 3 to cut false accepts |
| Per-window logging | `cfg.verbose` / Kconfig | one line per 10 ms — tuning only |

Stats via `echo_wakeword_get_stats()`: windows scored, detections, suppressed windows, last
score. Use them to measure false-accept rate during the 1-hour kitchen test.
