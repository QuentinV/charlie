/*
 * echo_audio facade: the capture task (continuous 16 kHz mono tap + optional
 * utterance tap) and the playback task (TTS streaming to the speaker).
 *
 * Two jobs, one I2S data path:
 *
 *   capture  opens the codec at ECHO_AUDIO_SAMPLE_RATE_HZ (16 kHz) and reads
 *            stereo frames, keeping the left slot (the ES8311 ADC = microphone).
 *            Every frame goes to the monitor callback; while an utterance capture
 *            is active it also goes to the sink callback.
 *   playback opens the codec at the requested rate (the server's TTS is 22050 Hz),
 *            raises PA_CTRL and streams the queued samples until the caller ends
 *            the turn. It holds the I/O lock for the whole turn, which parks the
 *            capture task: the two cannot share one codec at different rates and
 *            the wake word is suppressed during playback anyway.
 *
 * echo_audio_play() never blocks the caller: it expands mono to the stereo I2S
 * format and pushes it into a stream buffer that the playback task drains.
 */
#include "echo_audio.h"

#include "sdkconfig.h"

#if defined(CONFIG_ECHO_AUDIO_ENABLED)

#include <math.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/stream_buffer.h"
#include "freertos/task.h"

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"

#include "echo_audio_internal.h"

static const char *TAG = "echo_audio";

#define CAPTURE_RATE_HZ       CONFIG_ECHO_AUDIO_SAMPLE_RATE_HZ
#define DEFAULT_TTS_RATE_HZ   22050
#define CAPTURE_FRAMES        320               /* 20 ms mono at 16 kHz             */
#define PLAY_FRAMES           256               /* scratch / receive granularity    */
#define TX_RING_BYTES         (64 * 1024)       /* ~0.75 s of TTS at 22050 Hz mono  */
#define PLAY_PUSH_TIMEOUT_MS  200
#define DRAIN_WAIT_MS         500
#define MAX_TURN_MS           30000
#define CAP_TASK_STACK        4096
#define CAP_TASK_PRIO         6
#define PLAY_TASK_STACK       4096
#define PLAY_TASK_PRIO        5

static struct {
    bool  inited;
    bool  started;
    bool  ready;

    SemaphoreHandle_t cfg_lock;   /* guards the callbacks / capture state pointers */
    SemaphoreHandle_t io_lock;    /* serialises all codec + I2S access            */

    echo_audio_pcm_cb_t monitor;
    void               *monitor_ctx;

    echo_audio_pcm_cb_t sink;
    void               *sink_ctx;
    volatile bool       capture_active;
    int64_t             capture_deadline_us;

    StreamBufferHandle_t tx_ring;
    volatile bool        tx_end;
    volatile uint32_t    tx_rate;
    volatile bool        playback_active;

    TaskHandle_t cap_task;
    TaskHandle_t play_task;
} s_audio;

/* ------------------------------------------------------------------------- */
/* capture task                                                              */
/* ------------------------------------------------------------------------- */

static void capture_task(void *arg)
{
    (void)arg;
    int16_t stereo[CAPTURE_FRAMES * 2];
    int16_t mono[CAPTURE_FRAMES];

    while (true) {
        /* The I/O lock also parks this task for the whole of a playback turn. */
        xSemaphoreTake(s_audio.io_lock, portMAX_DELAY);
        esp_err_t err = echo_audio_platform_open(CAPTURE_RATE_HZ);
        if (err == ESP_OK) {
            err = echo_audio_platform_read(stereo, CAPTURE_FRAMES);
        }
        xSemaphoreGive(s_audio.io_lock);

        if (err != ESP_OK) {
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }

        for (size_t i = 0; i < CAPTURE_FRAMES; i++) {
            mono[i] = stereo[i * 2];   /* left slot = ES8311 ADC (microphone) */
        }

        xSemaphoreTake(s_audio.cfg_lock, portMAX_DELAY);
        echo_audio_pcm_cb_t monitor = s_audio.monitor;
        void *monitor_ctx = s_audio.monitor_ctx;
        const bool capturing = s_audio.capture_active;
        echo_audio_pcm_cb_t sink = capturing ? s_audio.sink : NULL;
        void *sink_ctx = s_audio.sink_ctx;
        const bool expired = capturing && s_audio.capture_deadline_us != 0 &&
                             esp_timer_get_time() >= s_audio.capture_deadline_us;
        xSemaphoreGive(s_audio.cfg_lock);

        if (monitor != NULL) {
            monitor(mono, CAPTURE_FRAMES, monitor_ctx);
        }
        if (sink != NULL) {
            sink(mono, CAPTURE_FRAMES, sink_ctx);
        }
        if (expired) {
            /* Safety cap reached; the sink (echo_voice) usually ends earlier. */
            echo_audio_capture_stop();
        }
    }
}

/* ------------------------------------------------------------------------- */
/* playback task                                                             */
/* ------------------------------------------------------------------------- */

static void playback_task(void *arg)
{
    (void)arg;
    int16_t stereo[PLAY_FRAMES * 2];
    bool active = false;
    int64_t turn_start_us = 0;

    while (true) {
        size_t got = xStreamBufferReceive(s_audio.tx_ring, stereo, sizeof(stereo),
                                          pdMS_TO_TICKS(DRAIN_WAIT_MS));

        if (!active) {
            if (got == 0) {
                continue;   /* nothing queued yet */
            }
            /* Start a turn: take the I/O lock for its whole duration so the
             * capture task cannot flip the codec rate underneath us. */
            xSemaphoreTake(s_audio.io_lock, portMAX_DELAY);
            const uint32_t rate = s_audio.tx_rate ? s_audio.tx_rate : DEFAULT_TTS_RATE_HZ;
            if (echo_audio_platform_open(rate) != ESP_OK) {
                xSemaphoreGive(s_audio.io_lock);
                continue;
            }
            echo_audio_platform_pa(true);
            s_audio.playback_active = true;
            active = true;
            turn_start_us = esp_timer_get_time();
            (void)echo_audio_platform_write(stereo, got / (2 * sizeof(int16_t)));
            continue;
        }

        if (got > 0) {
            (void)echo_audio_platform_write(stereo, got / (2 * sizeof(int16_t)));
            continue;
        }

        /* Queue drained for DRAIN_WAIT_MS: finish only when the caller ended the
         * turn, or when a stuck turn exceeded its hard cap. */
        const bool timed_out = (esp_timer_get_time() - turn_start_us) >
                               (int64_t)MAX_TURN_MS * 1000;
        if (!s_audio.tx_end && !timed_out) {
            continue;
        }
        echo_audio_platform_pa(false);
        s_audio.playback_active = false;
        active = false;
        xSemaphoreGive(s_audio.io_lock);
    }
}

/* ------------------------------------------------------------------------- */
/* public API                                                                */
/* ------------------------------------------------------------------------- */

esp_err_t echo_audio_init(void)
{
    if (s_audio.inited) {
        return s_audio.ready ? ESP_OK : ESP_ERR_NOT_FOUND;
    }

    s_audio.cfg_lock = xSemaphoreCreateMutex();
    s_audio.io_lock = xSemaphoreCreateMutex();
    if (s_audio.cfg_lock == NULL || s_audio.io_lock == NULL) {
        return ESP_ERR_NO_MEM;
    }
    s_audio.inited = true;

    esp_err_t err = echo_audio_platform_init();
    s_audio.ready = (err == ESP_OK);
    return err;
}

esp_err_t echo_audio_start(void)
{
    if (!s_audio.ready) {
        return ESP_ERR_INVALID_STATE;
    }
    if (s_audio.started) {
        return ESP_OK;
    }

    s_audio.tx_ring = xStreamBufferCreate(TX_RING_BYTES, 1);
    if (s_audio.tx_ring == NULL) {
        return ESP_ERR_NO_MEM;
    }
    if (xTaskCreate(capture_task, "echo_audio_cap", CAP_TASK_STACK, NULL, CAP_TASK_PRIO,
                    &s_audio.cap_task) != pdPASS) {
        vStreamBufferDelete(s_audio.tx_ring);
        s_audio.tx_ring = NULL;
        return ESP_ERR_NO_MEM;
    }
    if (xTaskCreate(playback_task, "echo_audio_ply", PLAY_TASK_STACK, NULL, PLAY_TASK_PRIO,
                    &s_audio.play_task) != pdPASS) {
        vTaskDelete(s_audio.cap_task);
        s_audio.cap_task = NULL;
        vStreamBufferDelete(s_audio.tx_ring);
        s_audio.tx_ring = NULL;
        return ESP_ERR_NO_MEM;
    }

    s_audio.started = true;
    ESP_LOGI(TAG, "capture started at %d Hz mono", CAPTURE_RATE_HZ);
    return ESP_OK;
}

esp_err_t echo_audio_stop(void)
{
    if (!s_audio.started) {
        return ESP_OK;
    }
    s_audio.started = false;

    if (s_audio.cap_task != NULL) {
        vTaskDelete(s_audio.cap_task);
        s_audio.cap_task = NULL;
    }
    if (s_audio.play_task != NULL) {
        vTaskDelete(s_audio.play_task);
        s_audio.play_task = NULL;
    }
    echo_audio_platform_pa(false);
    echo_audio_platform_close();
    if (s_audio.tx_ring != NULL) {
        vStreamBufferDelete(s_audio.tx_ring);
        s_audio.tx_ring = NULL;
    }
    s_audio.capture_active = false;
    s_audio.playback_active = false;
    return ESP_OK;
}

bool echo_audio_is_ready(void)
{
    return s_audio.ready;
}

esp_err_t echo_audio_set_monitor(echo_audio_pcm_cb_t cb, void *ctx)
{
    if (!s_audio.inited) {
        return ESP_ERR_INVALID_STATE;
    }
    xSemaphoreTake(s_audio.cfg_lock, portMAX_DELAY);
    s_audio.monitor = cb;
    s_audio.monitor_ctx = ctx;
    xSemaphoreGive(s_audio.cfg_lock);
    return ESP_OK;
}

esp_err_t echo_audio_capture_start(echo_audio_pcm_cb_t sink, void *ctx, uint32_t max_ms)
{
    if (!s_audio.started) {
        return ESP_ERR_INVALID_STATE;
    }
    if (sink == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    xSemaphoreTake(s_audio.cfg_lock, portMAX_DELAY);
    s_audio.sink = sink;
    s_audio.sink_ctx = ctx;
    s_audio.capture_deadline_us =
        max_ms ? esp_timer_get_time() + (int64_t)max_ms * 1000 : 0;
    s_audio.capture_active = true;
    xSemaphoreGive(s_audio.cfg_lock);
    return ESP_OK;
}

esp_err_t echo_audio_capture_stop(void)
{
    if (s_audio.cfg_lock == NULL) {
        return ESP_OK;
    }
    xSemaphoreTake(s_audio.cfg_lock, portMAX_DELAY);
    s_audio.capture_active = false;
    s_audio.capture_deadline_us = 0;
    s_audio.sink = NULL;
    s_audio.sink_ctx = NULL;
    xSemaphoreGive(s_audio.cfg_lock);
    return ESP_OK;
}

bool echo_audio_capture_active(void)
{
    return s_audio.capture_active;
}

esp_err_t echo_audio_play(const int16_t *pcm, size_t samples, uint32_t sample_rate_hz)
{
    if (pcm == NULL || samples == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!s_audio.started) {
        return ESP_ERR_INVALID_STATE;
    }

    /* Note the rate before pushing so the playback task picks it up on its first
     * frame of the turn. */
    s_audio.tx_rate = sample_rate_hz ? sample_rate_hz : DEFAULT_TTS_RATE_HZ;

    int16_t stereo[PLAY_FRAMES * 2];
    size_t done = 0;
    while (done < samples) {
        size_t chunk = samples - done;
        if (chunk > PLAY_FRAMES) {
            chunk = PLAY_FRAMES;
        }
        for (size_t i = 0; i < chunk; i++) {
            stereo[i * 2]     = pcm[done + i];   /* mono -> both I2S slots */
            stereo[i * 2 + 1] = pcm[done + i];
        }
        const size_t bytes = chunk * 2 * sizeof(int16_t);
        const size_t sent = xStreamBufferSend(s_audio.tx_ring, stereo, bytes,
                                              pdMS_TO_TICKS(PLAY_PUSH_TIMEOUT_MS));
        if (sent < bytes) {
            ESP_LOGW(TAG, "playback queue full, dropped %u of %u bytes",
                     (unsigned)(bytes - sent), (unsigned)bytes);
        }
        done += chunk;
    }
    return ESP_OK;
}

esp_err_t echo_audio_play_end(void)
{
    s_audio.tx_end = true;
    return ESP_OK;
}

esp_err_t echo_audio_play_tone(uint16_t freq_hz, uint32_t duration_ms)
{
    if (!s_audio.started) {
        return ESP_ERR_INVALID_STATE;
    }
    if (freq_hz == 0 || duration_ms == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    const uint32_t rate = CAPTURE_RATE_HZ;
    const uint32_t total = (uint32_t)((uint64_t)rate * duration_ms / 1000ULL);
    if (total == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    int16_t *pcm = (int16_t *)heap_caps_malloc(total * sizeof(int16_t), MALLOC_CAP_INTERNAL);
    if (pcm == NULL) {
        return ESP_ERR_NO_MEM;
    }

    /* A short linear fade in/out avoids the click a hard-edged tone makes. */
    uint32_t fade = rate / 100;   /* 10 ms */
    if (fade > total / 2) {
        fade = total / 2;
    }
    const double two_pi = 6.283185307179586;
    const double step = two_pi * (double)freq_hz / (double)rate;
    const double amp = 12000.0;   /* ~-9 dBFS, comfortable on the NS4150B */
    for (uint32_t i = 0; i < total; i++) {
        double env = 1.0;
        if (fade > 0) {
            if (i < fade) {
                env = (double)i / (double)fade;
            } else if (i >= total - fade) {
                env = (double)(total - 1 - i) / (double)fade;
            }
        }
        pcm[i] = (int16_t)(sin(step * (double)i) * env * amp);
    }

    esp_err_t err = echo_audio_play(pcm, total, rate);
    heap_caps_free(pcm);
    if (err != ESP_OK) {
        return err;
    }
    return echo_audio_play_end();
}

bool echo_audio_playback_active(void)
{
    return s_audio.playback_active;
}

void echo_audio_pa_enable(bool on)
{
    echo_audio_platform_pa(on);
}

#else /* !CONFIG_ECHO_AUDIO_ENABLED */

esp_err_t echo_audio_init(void)  { return ESP_ERR_INVALID_STATE; }
esp_err_t echo_audio_start(void) { return ESP_ERR_INVALID_STATE; }
esp_err_t echo_audio_stop(void)  { return ESP_OK; }
bool      echo_audio_is_ready(void) { return false; }
esp_err_t echo_audio_set_monitor(echo_audio_pcm_cb_t cb, void *ctx) { (void)cb; (void)ctx; return ESP_ERR_INVALID_STATE; }
esp_err_t echo_audio_capture_start(echo_audio_pcm_cb_t sink, void *ctx, uint32_t max_ms) { (void)sink; (void)ctx; (void)max_ms; return ESP_ERR_INVALID_STATE; }
esp_err_t echo_audio_capture_stop(void) { return ESP_OK; }
bool      echo_audio_capture_active(void) { return false; }
esp_err_t echo_audio_play(const int16_t *pcm, size_t samples, uint32_t sample_rate_hz) { (void)pcm; (void)samples; (void)sample_rate_hz; return ESP_ERR_INVALID_STATE; }
esp_err_t echo_audio_play_end(void) { return ESP_OK; }
esp_err_t echo_audio_play_tone(uint16_t freq_hz, uint32_t duration_ms) { (void)freq_hz; (void)duration_ms; return ESP_ERR_INVALID_STATE; }
bool      echo_audio_playback_active(void) { return false; }
void      echo_audio_pa_enable(bool on) { (void)on; }

#endif /* CONFIG_ECHO_AUDIO_ENABLED */



