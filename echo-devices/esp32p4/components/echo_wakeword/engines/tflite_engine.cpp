/*
 * TFLite-Micro "Hey Charlie" scoring engine for echo_wakeword.
 *
 * Pipeline, per call to score():
 *
 *   window[640] (40 ms, 16 kHz mono int16)
 *      -> take the newest 480 samples (30 ms)          [stft_frame_len]
 *      -> Hann window, zero-pad to 512, real FFT       [dsps_fft2r_fc32]
 *      -> power spectrum, 257 bins
 *      -> 40 triangular mel filters, log(max(x, eps))  [mel_bins]
 *      -> push one frame into a 40-frame rolling buffer [mel_frames]
 *      -> int8-quantise 40x40x1, Invoke()
 *      -> dequantise output, clamp to [0,1]
 *
 * The policy layer calls score() once per 10 ms hop, so consecutive calls advance by one
 * 10 ms step and the rolling buffer always ends at "now". That reproduces a standard
 * 30 ms / 10 ms STFT with 40-frame context = 400 ms of audio per inference. The engine
 * therefore needs no audio ring buffer of its own; it only keeps feature state.
 *
 * *** THE FEATURE PARAMETERS BELOW MUST MATCH THE TRAINING SCRIPT EXACTLY. ***
 * A mismatch (window length, mel scale, fmin/fmax, log epsilon, normalisation) does not
 * fail loudly — the model simply scores everything low. Keep this block and the Python
 * training script in sync, and diff them whenever either changes.
 */

#include "sdkconfig.h"

#if CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED

#include <math.h>
#include <string.h>
#include <new>          /* placement new for the interpreter and op resolver */

#include "esp_log.h"
#include "esp_partition.h"
#include "esp_heap_caps.h"

#include "dsps_fft2r.h"   /* dsps_fft2r_init_fc32, dsps_fft2r_fc32, dsps_bit_rev_fc32 */

#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/micro/micro_mutable_op_resolver.h"
#include "tensorflow/lite/schema/schema_generated.h"

#include "echo_wakeword.h"
#include "echo_wakeword_tflite.h"

static const char *TAG = "ww_tflite";

#ifndef M_PI
#  define M_PI 3.14159265358979323846
#endif

/* ------------------------------------------------------------------------------------------
 * Feature configuration — mirror of the training script. Change both or neither.
 * ---------------------------------------------------------------------------------------- */
#define WW_SAMPLE_RATE_HZ    16000
#define WW_STFT_FRAME_LEN    480     /* 30 ms analysis window                          */
#define WW_FFT_SIZE          512     /* next power of two >= frame len                 */
#define WW_FFT_BINS          (WW_FFT_SIZE / 2 + 1)   /* 257 real-valued bins            */
#define WW_MEL_BINS          40
#define WW_MEL_FRAMES        40      /* 400 ms of context at a 10 ms hop               */
#define WW_MEL_FMIN_HZ       125.0f
#define WW_MEL_FMAX_HZ       7500.0f
#define WW_LOG_EPSILON       1.0e-6f

/* Model plumbing. */
#define WW_MODEL_PARTITION   "model"
#define WW_ARENA_BYTES       (96 * 1024)   /* size the interpreter reports + 20 % headroom */
#define WW_INPUT_ELEMENTS    (WW_MEL_FRAMES * WW_MEL_BINS)

/* ------------------------------------------------------------------------------------------
 * State. Everything lives here; the engine is single-task by contract, so no locking.
 * ---------------------------------------------------------------------------------------- */
typedef struct {
    /* model */
    const esp_partition_t        *partition;
    esp_partition_mmap_handle_t   mmap_handle;
    const void                   *model_data;
    size_t                        model_len;

    /* interpreter: placement-new'd into static storage, never heap-allocated */
    tflite::MicroInterpreter     *interpreter;
    tflite::MicroMutableOpResolver<12> *resolver;
    uint8_t                      *arena;
    size_t                        arena_size;

    /* feature state (internal RAM: touched every 10 ms) */
    float *frames;      /* [WW_MEL_FRAMES][WW_MEL_BINS], chronological, newest last */
    float *fft_buf;     /* [2 * WW_FFT_SIZE] complex interleaved                   */
    float *hann;        /* [WW_STFT_FRAME_LEN]                                     */
    float *power;       /* [WW_FFT_BINS]                                           */

    /* filterbank (PSRAM: 40 * 257 floats = 41 KB, read once per frame) */
    float *mel_bank;    /* [WW_MEL_BINS][WW_FFT_BINS]                              */

    uint32_t frames_seen;
    bool     warm;      /* true once the rolling buffer is full */
    bool     ready;
    float    threshold;
} ww_engine_state_t;

static ww_engine_state_t s_ww;

/* Placement-new storage for the interpreter and resolver (both are large; keeping them in
 * .bss avoids fragmenting the heap and keeps init deterministic). */
alignas(16) static uint8_t s_interp_storage[sizeof(tflite::MicroInterpreter)];
alignas(16) static uint8_t s_resolver_storage[sizeof(tflite::MicroMutableOpResolver<12>)];

/* Embedded-model fallback. If the build embeds a model with
 *     target_add_binary_data(echo_wakeword "models/hey_charlie.tflite" BINARY)
 * these weak symbols exist; otherwise they are NULL and the partition is used instead. */
extern const uint8_t hey_charlie_tflite_start[] asm("_binary_hey_charlie_tflite_start") __attribute__((weak));
extern const uint8_t hey_charlie_tflite_end[]   asm("_binary_hey_charlie_tflite_end")   __attribute__((weak));

/* ------------------------------------------------------------------------------------------
 * Frontend helpers.
 * ---------------------------------------------------------------------------------------- */

static inline float hz_to_mel(float hz)
{
    return 2595.0f * log10f(1.0f + hz / 700.0f);
}

static inline float mel_to_hz(float mel)
{
    return 700.0f * (powf(10.0f, mel / 2595.0f) - 1.0f);
}

/* Triangular filters, linearly spaced on the mel scale between fmin and fmax. Frequencies
 * below the lowest or above the highest bin are dropped rather than clamped. */
static void build_mel_bank(float *bank)
{
    const float bin_hz   = (float)WW_SAMPLE_RATE_HZ / (float)WW_FFT_SIZE;
    const float mel_min  = hz_to_mel(WW_MEL_FMIN_HZ);
    const float mel_max  = hz_to_mel(WW_MEL_FMAX_HZ);
    const float mel_step = (mel_max - mel_min) / (float)(WW_MEL_BINS + 1);

    memset(bank, 0, sizeof(float) * WW_MEL_BINS * WW_FFT_BINS);

    for (int m = 0; m < WW_MEL_BINS; m++) {
        const float lo = mel_to_hz(mel_min + mel_step * (float)m);
        const float ce = mel_to_hz(mel_min + mel_step * (float)(m + 1));
        const float hi = mel_to_hz(mel_min + mel_step * (float)(m + 2));
        float *row = bank + (size_t)m * WW_FFT_BINS;

        for (int k = 0; k < WW_FFT_BINS; k++) {
            const float f = bin_hz * (float)k;
            float w = 0.0f;
            if (f >= lo && f <= ce) {
                w = (ce - lo) > 0.0f ? (f - lo) / (ce - lo) : 0.0f;
            } else if (f > ce && f <= hi) {
                w = (hi - ce) > 0.0f ? (hi - f) / (hi - ce) : 0.0f;
            }
            row[k] = w;
        }
    }
}

/* Periodic Hann (denominator N), i.e. scipy.signal.get_window('hann', N, fftbins=True).
 * If the training script used numpy.hanning (symmetric, denominator N-1), change the
 * denominator below to WW_STFT_FRAME_LEN - 1 or the features will be slightly off. */
static void build_hann(float *w)
{
    for (int i = 0; i < WW_STFT_FRAME_LEN; i++) {
        w[i] = 0.5f - 0.5f * cosf(2.0f * (float)M_PI * (float)i / (float)WW_STFT_FRAME_LEN);
    }
}

/* Compute one mel frame from the newest WW_STFT_FRAME_LEN samples of the window and push
 * it into the rolling buffer (oldest frame discarded). Returns false on a short window. */
static bool push_feature_frame(const int16_t *window, size_t samples)
{
    if (window == NULL || samples < WW_STFT_FRAME_LEN) {
        return false;
    }

    const int16_t *src = window + (samples - WW_STFT_FRAME_LEN);

    /* Real FFT in esp-dsp's interleaved complex layout: imaginary part must be zero. */
    for (int i = 0; i < WW_STFT_FRAME_LEN; i++) {
        s_ww.fft_buf[2 * i]     = ((float)src[i] / 32768.0f) * s_ww.hann[i];
        s_ww.fft_buf[2 * i + 1] = 0.0f;
    }
    for (int i = WW_STFT_FRAME_LEN; i < WW_FFT_SIZE; i++) {
        s_ww.fft_buf[2 * i]     = 0.0f;
        s_ww.fft_buf[2 * i + 1] = 0.0f;
    }

    dsps_fft2r_fc32(s_ww.fft_buf, WW_FFT_SIZE);
    dsps_bit_rev_fc32(s_ww.fft_buf, WW_FFT_SIZE);

    /* Power spectrum, bins 0..N/2. */
    for (int k = 0; k < WW_FFT_BINS; k++) {
        const float re = s_ww.fft_buf[2 * k];
        const float im = s_ww.fft_buf[2 * k + 1];
        s_ww.power[k] = re * re + im * im;
    }

    /* Shift the rolling buffer one frame toward the past. 40 * 40 floats = 6.4 KB per 10 ms,
     * which is well under the P4's memory bandwidth. */
    memmove(s_ww.frames, s_ww.frames + WW_MEL_BINS,
            sizeof(float) * WW_MEL_BINS * (WW_MEL_FRAMES - 1));

    float *newest = s_ww.frames + (size_t)(WW_MEL_FRAMES - 1) * WW_MEL_BINS;
    for (int m = 0; m < WW_MEL_BINS; m++) {
        const float *row = s_ww.mel_bank + (size_t)m * WW_FFT_BINS;
        float acc = 0.0f;
        for (int k = 0; k < WW_FFT_BINS; k++) {
            acc += row[k] * s_ww.power[k];
        }
        newest[m] = logf(acc > WW_LOG_EPSILON ? acc : WW_LOG_EPSILON);
    }

    return true;
}

/* ------------------------------------------------------------------------------------------
 * Model loading. Partition "model" first (OTA-updatable), embedded blob as fallback.
 * ---------------------------------------------------------------------------------------- */

static esp_err_t locate_model(void)
{
    /* 1. Flash partition. The project's partitions.csv declares a data partition named
     *    "model" at 0x900000 (see engines/README.md for the CSV row); looked up by name,
     *    so the offset is free to change. Falls through to the embedded blob if absent. */
    s_ww.partition = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY,
                                              WW_MODEL_PARTITION);
    if (s_ww.partition != NULL) {
        const void *mapped = NULL;
        esp_err_t err = esp_partition_mmap(s_ww.partition, 0, s_ww.partition->size,
                                           ESP_PARTITION_MMAP_DATA, &mapped, &s_ww.mmap_handle);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "mmap of '%s' failed: %s", WW_MODEL_PARTITION, esp_err_to_name(err));
            s_ww.partition = NULL;
            return err;
        }
        s_ww.model_data = mapped;
        s_ww.model_len  = s_ww.partition->size;
        ESP_LOGI(TAG, "model mapped from partition '%s' (%u bytes)",
                 WW_MODEL_PARTITION, (unsigned)s_ww.model_len);
        return ESP_OK;
    }

    /* 2. Embedded blob. The weak symbols exist only when the model was added to the build
     *    with target_add_binary_data(); otherwise the comparison below sees NULL. */
    if (hey_charlie_tflite_start != NULL) {
        s_ww.model_data = hey_charlie_tflite_start;
        s_ww.model_len  = (size_t)(hey_charlie_tflite_end - hey_charlie_tflite_start);
        ESP_LOGI(TAG, "model taken from embedded blob (%u bytes)", (unsigned)s_ww.model_len);
        return ESP_OK;
    }

    ESP_LOGE(TAG, "no model: partition '%s' not found and no embedded blob linked",
             WW_MODEL_PARTITION);
    return ESP_ERR_NOT_FOUND;
}

/* Total element count of a tensor, ignoring leading/trailing 1s in the shape. */
static size_t tensor_element_count(const TfLiteTensor *t)
{
    size_t n = 1;
    for (int i = 0; i < t->dims->size; i++) {
        n *= (size_t)t->dims->data[i];
    }
    return n;
}

/* Accept [1,40,40,1], [40,40,1], [1,1600] and [1600]; anything else means the firmware
 * framing and the trained model disagree. */
static esp_err_t validate_io(void)
{
    TfLiteTensor *in  = s_ww.interpreter->input(0);
    TfLiteTensor *out = s_ww.interpreter->output(0);
    if (in == NULL || out == NULL) {
        ESP_LOGE(TAG, "model exposes no input/output tensor");
        return ESP_ERR_INVALID_ARG;
    }

    const size_t in_n = tensor_element_count(in);
    if (in_n != WW_INPUT_ELEMENTS) {
        ESP_LOGE(TAG, "input has %u elements, expected %u (%dx%dx1) - model/firmware mismatch",
                 (unsigned)in_n, (unsigned)WW_INPUT_ELEMENTS, WW_MEL_FRAMES, WW_MEL_BINS);
        return ESP_ERR_INVALID_SIZE;
    }
    if (in->type != kTfLiteInt8 && in->type != kTfLiteFloat32) {
        ESP_LOGE(TAG, "unsupported input type %d (want int8 or float32)", (int)in->type);
        return ESP_ERR_INVALID_ARG;
    }
    if (tensor_element_count(out) != 1) {
        ESP_LOGE(TAG, "output has %u elements, expected 1 (single confidence)",
                 (unsigned)tensor_element_count(out));
        return ESP_ERR_INVALID_SIZE;
    }
    if (out->type != kTfLiteInt8 && out->type != kTfLiteUInt8 && out->type != kTfLiteFloat32) {
        ESP_LOGE(TAG, "unsupported output type %d", (int)out->type);
        return ESP_ERR_INVALID_ARG;
    }

    ESP_LOGI(TAG, "model IO ok: in %d dims / %u elems, out type %d",
             in->dims->size, (unsigned)in_n, (int)out->type);
    return ESP_OK;
}

/* ------------------------------------------------------------------------------------------
 * Allocation helpers. Hot-path buffers go to internal RAM (touched every 10 ms); the large
 * read-mostly filterbank goes to PSRAM when available. The tensor arena goes to PSRAM first:
 * a 40x40 CNN's arena is tens of KB and internal RAM is better spent on the audio path.
 * ---------------------------------------------------------------------------------------- */

static void *alloc_internal(size_t bytes)
{
    return heap_caps_malloc(bytes, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
}

static void *alloc_prefer_psram(size_t bytes)
{
    void *p = heap_caps_aligned_alloc(16, bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (p == NULL) {
        ESP_LOGW(TAG, "PSRAM allocation of %u bytes failed, falling back to internal RAM",
                 (unsigned)bytes);
        p = heap_caps_aligned_alloc(16, bytes, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    }
    return p;
}

static void release_buffers(void)
{
    heap_caps_free(s_ww.frames);
    heap_caps_free(s_ww.fft_buf);
    heap_caps_free(s_ww.power);
    heap_caps_free(s_ww.hann);
    heap_caps_free(s_ww.mel_bank);
    heap_caps_free(s_ww.arena);
    /* Assigned separately: arena is uint8_t* while the frontend buffers are float*, so a
     * chained assignment would try to convert between the two pointer types. */
    s_ww.frames   = NULL;
    s_ww.fft_buf  = NULL;
    s_ww.power    = NULL;
    s_ww.hann     = NULL;
    s_ww.mel_bank = NULL;
    s_ww.arena    = NULL;
}

static void engine_deinit(void);   /* defined below; used by the init failure paths */

/* Build the interpreter, allocate tensors and verify the IO contract. Split out of engine_init()
 * only to keep each function short enough to read; it is always called from there. */
static esp_err_t engine_start_interpreter(const tflite::Model *model)
{
    /* Op resolver. Adjust this list to the ops the trained model actually uses; a missing op
     * fails at AllocateTensors()/Invoke() with "Didn't find op for builtin opcode". */
    s_ww.resolver = new (s_resolver_storage) tflite::MicroMutableOpResolver<12>();

    /* Register one op at a time. The AddXxx() helpers each take an optional
     * const TFLMRegistration& argument, so they cannot be stored in a table of plain
     * member-function pointers; explicit calls keep this obvious and version-proof. */
    struct op_registration {
        TfLiteStatus status;
        const char  *name;
    };
    const op_registration kOps[] = {
        { s_ww.resolver->AddConv2D(),          "Conv2D"          },
        { s_ww.resolver->AddDepthwiseConv2D(), "DepthwiseConv2D" },
        { s_ww.resolver->AddFullyConnected(),  "FullyConnected"  },
        { s_ww.resolver->AddReshape(),         "Reshape"         },
        { s_ww.resolver->AddSoftmax(),         "Softmax"         },
        { s_ww.resolver->AddLogistic(),        "Logistic"        },
        { s_ww.resolver->AddAdd(),             "Add"             },
        { s_ww.resolver->AddMul(),             "Mul"             },
        { s_ww.resolver->AddMean(),            "Mean"            },
        { s_ww.resolver->AddMaxPool2D(),       "MaxPool2D"       },
        { s_ww.resolver->AddAveragePool2D(),   "AveragePool2D"   },
        { s_ww.resolver->AddRelu(),            "Relu"            },
    };
    for (size_t i = 0; i < sizeof(kOps) / sizeof(kOps[0]); i++) {
        if (kOps[i].status != kTfLiteOk) {
            ESP_LOGE(TAG, "failed to register op %s", kOps[i].name);
            engine_deinit();
            return ESP_ERR_INVALID_ARG;
        }
    }

    /* Placement-new into static storage: no heap fragmentation and the object lives as long
     * as the engine. A second init() is rejected above, so this storage is never reused. */
    s_ww.interpreter = new (s_interp_storage)
        tflite::MicroInterpreter(model, *s_ww.resolver, s_ww.arena, s_ww.arena_size);

    if (s_ww.interpreter->AllocateTensors() != kTfLiteOk) {
        ESP_LOGE(TAG, "AllocateTensors failed - arena too small (%u bytes) or an op is missing",
                 (unsigned)s_ww.arena_size);
        engine_deinit();
        return ESP_ERR_NO_MEM;
    }

    esp_err_t err = validate_io();
    if (err != ESP_OK) {
        engine_deinit();
        return err;
    }

    s_ww.ready = true;
    ESP_LOGI(TAG, "engine ready: %u/%u arena bytes used, threshold %.2f",
             (unsigned)s_ww.interpreter->arena_used_bytes(), (unsigned)s_ww.arena_size,
             (double)s_ww.threshold);
    return ESP_OK;
}

/* ------------------------------------------------------------------------------------------
 * Engine init.
 * ---------------------------------------------------------------------------------------- */

static esp_err_t engine_init(float threshold)
{
    if (s_ww.ready) {
        ESP_LOGW(TAG, "engine already initialised");
        return ESP_ERR_INVALID_STATE;
    }
    memset(&s_ww, 0, sizeof(s_ww));
    s_ww.threshold = threshold;

    /* 1. Frontend buffers. */
    s_ww.frames   = (float *)alloc_internal(sizeof(float) * WW_MEL_BINS * WW_MEL_FRAMES);
    s_ww.fft_buf  = (float *)alloc_internal(sizeof(float) * 2 * WW_FFT_SIZE);
    s_ww.power    = (float *)alloc_internal(sizeof(float) * WW_FFT_BINS);
    s_ww.hann     = (float *)alloc_internal(sizeof(float) * WW_STFT_FRAME_LEN);
    s_ww.mel_bank = (float *)alloc_prefer_psram(sizeof(float) * WW_MEL_BINS * WW_FFT_BINS);
    if (!s_ww.frames || !s_ww.fft_buf || !s_ww.power || !s_ww.hann || !s_ww.mel_bank) {
        ESP_LOGE(TAG, "frontend buffer allocation failed");
        release_buffers();
        return ESP_ERR_NO_MEM;
    }
    build_hann(s_ww.hann);
    build_mel_bank(s_ww.mel_bank);

    /* 2. FFT tables. esp-dsp keeps one global table; init once and never re-init while the
     *    engine lives. Passing NULL lets the library size its own table. */
    esp_err_t err = dsps_fft2r_init_fc32(NULL, WW_FFT_SIZE);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "dsps_fft2r_init_fc32 failed: %s", esp_err_to_name(err));
        release_buffers();
        return err;
    }

    /* 3. Model blob. */
    err = locate_model();
    if (err != ESP_OK) {
        release_buffers();
        return err;
    }

    const tflite::Model *model = tflite::GetModel(s_ww.model_data);
    if (model->version() != TFLITE_SCHEMA_VERSION) {
        ESP_LOGE(TAG, "model schema %lu != runtime schema %d - regenerate the .tflite with "
                      "the same TFLite version used by esp-tflite-micro",
                 (unsigned long)model->version(), (int)TFLITE_SCHEMA_VERSION);
        engine_deinit();
        return ESP_ERR_INVALID_VERSION;
    }

    /* 4. Tensor arena. */
    s_ww.arena_size = WW_ARENA_BYTES;
    s_ww.arena = (uint8_t *)alloc_prefer_psram(s_ww.arena_size);
    if (s_ww.arena == NULL) {
        ESP_LOGE(TAG, "tensor arena allocation failed (%u bytes)", (unsigned)s_ww.arena_size);
        engine_deinit();
        return ESP_ERR_NO_MEM;
    }

    return engine_start_interpreter(model);
}

/* ------------------------------------------------------------------------------------------
 * Scoring. Called once per 10 ms hop from echo_wakeword_feed(). Must stay allocation-free and
 * reasonably short: it runs on the caller's task (the AFE task), holding no locks but delaying
 * the audio path by one inference per hop.
 * ---------------------------------------------------------------------------------------- */

static float engine_score(const int16_t *window, size_t samples)
{
    if (!s_ww.ready) {
        return 0.0f;
    }
    if (window == NULL || samples < WW_STFT_FRAME_LEN) {
        /* Should not happen: the policy layer always hands over a full 40 ms window. */
        ESP_LOGW(TAG, "short window (%u samples), skipping", (unsigned)samples);
        return 0.0f;
    }

    if (!push_feature_frame(window, samples)) {
        return 0.0f;
    }

    /* Warm-up: the model needs WW_MEL_FRAMES frames of context before a score means anything. */
    s_ww.frames_seen++;
    if (s_ww.frames_seen < WW_MEL_FRAMES) {
        return 0.0f;
    }
    s_ww.warm = true;

    TfLiteTensor *in  = s_ww.interpreter->input(0);
    TfLiteTensor *out = s_ww.interpreter->output(0);

    /* Quantise the feature matrix into the input tensor using the model's own parameters. */
    if (in->type == kTfLiteInt8) {
        const float scale = in->params.scale;
        const int   zp    = in->params.zero_point;
        int8_t     *dst   = in->data.int8;
        for (size_t i = 0; i < WW_INPUT_ELEMENTS; i++) {
            long q = lrintf(s_ww.frames[i] / scale) + zp;
            if (q < -128) q = -128;
            if (q > 127)  q = 127;
            dst[i] = (int8_t)q;
        }
    } else {
        memcpy(in->data.f, s_ww.frames, sizeof(float) * WW_INPUT_ELEMENTS);
    }

    if (s_ww.interpreter->Invoke() != kTfLiteOk) {
        ESP_LOGE(TAG, "Invoke failed");
        return 0.0f;
    }

    float score = 0.0f;
    switch (out->type) {
    case kTfLiteInt8:
        score = ((float)out->data.int8[0] - (float)out->params.zero_point) * out->params.scale;
        break;
    case kTfLiteUInt8:
        score = ((float)out->data.uint8[0] - (float)out->params.zero_point) * out->params.scale;
        break;
    case kTfLiteFloat32:
        score = out->data.f[0];
        break;
    default:
        ESP_LOGE(TAG, "unexpected output type %d", (int)out->type);
        return 0.0f;
    }

    if (score < 0.0f) score = 0.0f;
    if (score > 1.0f) score = 1.0f;
    return score;
}

/* ------------------------------------------------------------------------------------------
 * Teardown. Idempotent: safe to call from init failure paths and from echo_wakeword_deinit().
 * ---------------------------------------------------------------------------------------- */

static void engine_deinit(void)
{
    if (s_ww.interpreter != NULL) {
        s_ww.interpreter->~MicroInterpreter();
        s_ww.interpreter = NULL;
    }
    /* The resolver is trivially destructible (it only holds op pointers); dropping the
     * pointer is enough. The storage stays reserved for a future init(). */
    s_ww.resolver = NULL;

    release_buffers();

    if (s_ww.partition != NULL && s_ww.mmap_handle != 0) {
        esp_partition_munmap(s_ww.mmap_handle);
    }
    s_ww.partition   = NULL;
    s_ww.mmap_handle = 0;
    s_ww.model_data  = NULL;
    s_ww.model_len   = 0;

    s_ww.ready       = false;
    s_ww.warm        = false;
    s_ww.frames_seen = 0;
}

/* ------------------------------------------------------------------------------------------
 * Engine export. The policy layer attaches this through echo_wakeword_attach_engine().
 * ---------------------------------------------------------------------------------------- */

extern "C" const echo_wakeword_engine_t echo_wakeword_tflite_engine = {
    engine_init,    /* esp_err_t (*)(float threshold)                        */
    engine_score,   /* float     (*)(const int16_t *window, size_t samples)  */
    engine_deinit,  /* void      (*)(void)                                   */
};

#endif /* CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED */
