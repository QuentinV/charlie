# Wake-word engines

`echo_wakeword` owns the *policy* (40 ms windows, 10 ms hop, smoothing, threshold, cooldown,
TTS suppression, dispatch). It does not own the *model*. This directory holds the model
implementations it can attach.

| File | Builds when | Purpose |
| --- | --- | --- |
| `tflite_engine.cpp` | `CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED=y` | Streaming mel frontend + TFLite-Micro interpreter for `hey_charlie.tflite` |

The default build compiles none of this. The component stays green and runs in buffer-only
mode, logging `no engine attached - buffering only, detections disabled`.

## The engine contract

`include/echo_wakeword.h` defines:

```c
typedef struct {
    esp_err_t (*init)(float threshold);
    float     (*score)(const int16_t *window, size_t samples);
    void      (*deinit)(void);
} echo_wakeword_engine_t;
```

- `init(threshold)` is called once from `echo_wakeword_init()`. Return an `esp_err_t`; any
  non-`ESP_OK` value aborts component init (see "Known integration issues").
- `score(window, samples)` is called **once per 10 ms hop** with the most recent
  `ECHO_WAKEWORD_WINDOW_SAMPLES` (= 640, i.e. 40 ms at 16 kHz) mono `int16_t` samples.
  Return a confidence in `[0.0, 1.0]`. Called from whatever task fed audio, i.e. the ESP-SR
  AFE task. It must not allocate in steady state and must not block for long.
- `deinit()` is optional and idempotent.

The engine must keep its own streaming feature state. `score()` may be called four times
with windows that overlap by 30 ms; recomputing those 30 ms of spectrum is normal STFT
behaviour and is cheaper than duplicating the policy layer's ring buffer.

### Framing arithmetic — get this right or the model will underperform

| Quantity | Value | Why |
| --- | --- | --- |
| Sample rate | 16 000 Hz | matches ESP-SR AFE output |
| Analysis window | 480 samples (30 ms) | newest 480 of the 640-sample window |
| FFT size | 512 | next power of two; zero-padded |
| Hop | 160 samples (10 ms) | set by the policy layer |
| Mel bins | 40 | model input width |
| Mel frames | 40 | 400 ms of context per inference |
| Input tensor | 40 x 40 x 1 = 1600 | `[1,40,40,1]` in TFLite |

"40x40x1" is **40 time frames x 40 mel bins**, not 40 ms. A single 40 ms window cannot fill
that tensor; the engine accumulates frames and returns `0.0` until 40 hops have arrived
(~400 ms after the first audio). Do not "fix" that warm-up by padding — the model was
trained on real leading context.

## Enabling the engine

1. `idf.py menuconfig` (or `sdkconfig.defaults`) -> `echo_wakeword` ->
   `CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED=y`.
2. Dependencies come from `src/idf_component.yml`:
   `espressif/esp-tflite-micro ^1.4.1` and `espressif/esp-dsp ^1.8.2`. They are downloaded on
   every build but only compiled when the engine is enabled.
3. Attach it before init:

```c
#include "echo_wakeword.h"
#include "echo_wakeword_tflite.h"

#if CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED
    ESP_ERROR_CHECK(echo_wakeword_attach_engine(&echo_wakeword_tflite_engine));
#endif
echo_wakeword_config_t cfg = ECHO_WAKEWORD_CONFIG_DEFAULT();
ESP_ERROR_CHECK(echo_wakeword_init(&cfg));
```

`echo_wakeword_tflite.h` only declares the symbol when the Kconfig option is set, so the
include and the `#if` above are both safe in either build.

## Supplying the trained model

### Option A — flash partition (default, OTA-updatable)

The engine looks for a data partition literally named `model` and memory-maps it, so the
model never consumes RAM. This project currently has **no custom partition table**, so this
path fails until you add one. Minimal custom CSV (keep your existing app layout):

```csv
# name,   type, subtype, offset,   size,     flags
nvs,      data, nvs,     0x9000,   0x6000,
phy_init, data, phy,     0xf000,   0x1000,
factory,  app,  factory, 0x10000,  0x300000,
model,    data, spiffs,  0x310000, 0x100000,
```

Then set `CONFIG_PARTITION_TABLE_CUSTOM=y`,
`CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions.csv"`, and flash the blob once:

```bash
esptool.py --chip esp32p4 write_flash 0x310000 hey_charlie.tflite
```

`0x310000` must match the partition offset. The partition's *whole size* is what gets mapped,
so a 40 KB model in a 1 MB partition is fine — the flatbuffer's own header gives the length.
Padding with `0xFF` after the blob is harmless.


### Option B — embedded blob (no partition table needed)

```cmake
# components/echo_wakeword/CMakeLists.txt, inside the engine-enabled branch
target_add_binary_data(${COMPONENT_LIB} "models/hey_charlie.tflite" BINARY)
```

This creates `_binary_hey_charlie_tflite_start` / `_end`, which the engine declares as weak
symbols and uses when no `model` partition exists. The blob lands in the app image, so every
OTA carries it and the app partition must be large enough. The engine tries the partition
first; the blob is only a fallback.

## Syncing the frontend with the training script

`tflite_engine.cpp` opens with a configuration block. These values must match the Python
feature extractor **exactly**, or accuracy silently collapses:

| Macro | Meaning |
| --- | --- |
| `WW_STFT_FRAME_LEN` | 480 (30 ms) |
| `WW_FFT_SIZE` | 512 |
| `WW_MEL_BINS` | 40 |
| `WW_MEL_FRAMES` | 40 |
| `WW_MEL_FMIN_HZ` / `WW_MEL_FMAX_HZ` | 125 / 7500 |
| `WW_LOG_EPSILON` | 1e-6 |
| Hann variant | periodic (`fftbins=True`); switch to N-1 if training used `numpy.hanning` |
| Normalisation | currently none — log-mel is fed raw. If the training script mean/std-normalises, add it in `push_feature_frame()` |

Two more contract points:

- **Quantisation** is read from the model: input `params.scale` / `params.zero_point` are used
  to convert float features to int8, and the output is dequantised the same way. A float32
  input model also works; the engine copies floats instead.
- **Op set** — the resolver registers 12 ops (Conv2D, DepthwiseConv2D, FullyConnected,
  Reshape, Softmax, Logistic, Add, Mul, Mean, MaxPool2D, AveragePool2D, Relu). Trim or extend
  the `kOps` table to match your model. A missing op fails loudly at `AllocateTensors()`.

## Memory and timing

| Buffer | Size | Placement |
| --- | --- | --- |
| Mel filterbank | 40 x 257 x 4 = 41 KB | PSRAM preferred, internal fallback |
| Rolling feature buffer | 40 x 40 x 4 = 6.4 KB | internal RAM |
| FFT working buffer | 512 x 2 x 4 = 4 KB | internal RAM |
| Tensor arena | `WW_ARENA_BYTES` = 96 KB | PSRAM preferred, internal fallback |

96 KB is a starting point. After the first successful init the log prints
`engine ready: N/98304 arena bytes used` — set `WW_ARENA_BYTES` to about 1.2x N. Too small
gives `AllocateTensors failed`, too large wastes PSRAM.

Timing: the ESP-NN kernels make a small KWS CNN roughly 10–40 ms per `Invoke()` on the P4 at
360 MHz. Since `score()` runs inline on the caller's task, budget for one inference per 10 ms
hop: if it exceeds 10 ms the audio path falls behind and buffers overflow upstream. Measure
before shipping; if it is too slow, the fix is a dedicated inference task in the policy layer,
not a bigger buffer.

## Known integration issues

1. **Init failure aborts the component.** `echo_wakeword.cpp` sends any engine `init()` error
   to its failure path and returns `ESP_ERR_NO_MEM`, so a missing `model` partition makes
   `echo_wakeword_init()` fail outright instead of degrading to buffer-only mode. Until that
   changes, either handle the failure in `main.cpp` or leave the engine disabled on boards
   without a model. (Expected log today: `engine init failed: ESP_ERR_NOT_FOUND`.)
2. **Audio pipeline.** `echo_audio` now owns the I2S0 + ES8311 path and
   `echo_voice` feeds 16 kHz mono PCM to `echo_wakeword_feed()` and uploads an
   utterance to `echo_ha` after a detection. `score()` still runs inline on the
   capture task, so if inference exceeds one 10 ms hop the audio path falls
   behind (see the timing note below). The upstream options
   (`CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED`, `CONFIG_ECHO_AUDIO_ENABLED`,
   `CONFIG_ECHO_VOICE_ENABLED`) must be on for the loop to run.
3. **AFE task stack.** `score()` runs on the AFE task's stack. All large buffers here are
   heap/PSRAM, but TFLM's `Invoke()` needs a few KB of stack — raise the AFE task stack when
   audio lands.
4. **Threshold is informational.** The policy layer applies the threshold and smoothing; the
   engine only stores the value for logging. Do not threshold inside `score()`.
5. **`dsps_fft2r_init_fc32()` is global.** It initialises esp-dsp's shared FFT table. If
   anything else in the firmware also calls it with a different size, call it once at boot
   with the largest size needed and remove the call here.
