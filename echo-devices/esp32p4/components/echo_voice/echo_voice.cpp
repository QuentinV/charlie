/*
 * echo_voice — wake word -> microphone -> Charlie upload, plus TTS playback.
 *
 * The three participants stay ignorant of each other; this file is the only
 * place that knows the whole conversation:
 *
 *   echo_audio monitor  -> echo_wakeword_feed()          (always)
 *   echo_wakeword hit   -> ECHO_EVT_WAKE_WORD + record   (on detection)
 *   echo_audio sink     -> echo_ha_send_utterance_audio() (while recording)
 *   silence / cap       -> echo_ha_send_utterance_end()
 *   playAudio / TTS     -> echo_audio_play() + suppression
 *   ECHO_EVT_HA_TTS_END -> unsuppress, optional follow-up re-listen
 */
#include "echo_voice.h"

#include "sdkconfig.h"

#if defined(CONFIG_ECHO_VOICE_ENABLED)

#include <math.h>

#include "esp_log.h"
#include "esp_timer.h"

#include "echo_audio.h"
#include "echo_events.h"
#include "echo_ha.h"
#include "echo_wakeword.h"

static const char *TAG = "echo_voice";

#define UTTERANCE_MAX_MS CONFIG_ECHO_VOICE_UTTERANCE_MAX_MS
#define SILENCE_MS       CONFIG_ECHO_VOICE_SILENCE_MS
#define SILENCE_RMS      CONFIG_ECHO_VOICE_SILENCE_RMS
#define TTS_RATE_HZ      CONFIG_ECHO_VOICE_TTS_RATE_HZ

/* Milliseconds of audio in one capture frame (16 kHz mono). */
#define FRAME_MS(samples) \
    ((uint32_t)((uint64_t)(samples) * 1000 / CONFIG_ECHO_AUDIO_SAMPLE_RATE_HZ))

static struct {
    bool              ready;
    volatile bool     listening;
    int64_t           listen_deadline_us;
    volatile uint32_t silence_ms;
} s_voice;

static void voice_end_listen(void);

/* ---- ear: feed every captured frame to the wake word engine ------------- */

static void voice_monitor(const int16_t *pcm, size_t samples, void *ctx)
{
    (void)ctx;
    (void)echo_wakeword_feed(pcm, samples);
}

/* ---- mouth: hand each recorded frame to the Charlie client -------------- */

static void voice_sink(const int16_t *pcm, size_t samples, void *ctx)
{
    (void)ctx;
    if (!s_voice.listening || samples == 0) {
        return;
    }

    (void)echo_ha_send_utterance_audio(pcm, samples * sizeof(int16_t));

    /* Energy VAD: end the turn after SILENCE_MS of quiet frames. */
    int64_t sum = 0;
    for (size_t i = 0; i < samples; i++) {
        const int32_t v = pcm[i];
        sum += v * v;
    }
    const double rms = sqrt((double)sum / (double)samples);

    if (rms >= (double)SILENCE_RMS) {
        s_voice.silence_ms = 0;
    } else {
        s_voice.silence_ms += FRAME_MS(samples);
    }

    if (s_voice.silence_ms >= SILENCE_MS ||
        esp_timer_get_time() >= s_voice.listen_deadline_us) {
        voice_end_listen();
    }
}

/* ---- conversation state ------------------------------------------------- */

static void voice_begin_listen(void)
{
    if (!echo_ha_is_connected()) {
        ESP_LOGW(TAG, "not listening: Charlie server is not connected");
        return;
    }
    esp_err_t err = echo_ha_send_utterance_start();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "could not open the utterance: %s", esp_err_to_name(err));
        return;
    }

    s_voice.silence_ms = 0;
    s_voice.listen_deadline_us = esp_timer_get_time() + (int64_t)UTTERANCE_MAX_MS * 1000;
    s_voice.listening = true;
    err = echo_audio_capture_start(voice_sink, NULL, UTTERANCE_MAX_MS);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "capture start failed: %s", esp_err_to_name(err));
        s_voice.listening = false;
        (void)echo_ha_send_utterance_end();
        return;
    }
    ESP_LOGI(TAG, "listening (max %d ms)", UTTERANCE_MAX_MS);
}

static void voice_end_listen(void)
{
    if (!s_voice.listening) {
        return;
    }
    s_voice.listening = false;
    (void)echo_audio_capture_stop();
    esp_err_t err = echo_ha_send_utterance_end();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "could not close the utterance: %s", esp_err_to_name(err));
    }
    ESP_LOGI(TAG, "utterance sent");
}

/* ---- wake word ---------------------------------------------------------- */

static void voice_on_wake(void *ctx)
{
    (void)ctx;
    echo_wakeword_stats_t stats = {};
    echo_wakeword_get_stats(&stats);

    echo_wake_word_t evt = {};
    evt.score_permille = (uint32_t)(stats.last_score * 1000.0f + 0.5f);
    evt.timestamp_us = esp_timer_get_time();
    (void)echo_event_bus_post(ECHO_EVT_WAKE_WORD, &evt, sizeof(evt));

    ESP_LOGI(TAG, "wake word detected (score %.3f)", (double)stats.last_score);
    voice_begin_listen();
}

/* ---- assistant reply (TTS) --------------------------------------------- */

static void voice_on_play_audio(bool follow_up, void *ctx)
{
    (void)follow_up;
    (void)ctx;
    /* A reply is about to stream: stop listening and mute the detector so the
     * speaker cannot trigger it (there is no AEC in this path yet). */
    echo_wakeword_set_suppressed(true);
    if (s_voice.listening) {
        voice_end_listen();
    }
}

static void voice_on_tts_audio(const uint8_t *pcm, size_t len, void *ctx)
{
    (void)ctx;
    const size_t samples = len / sizeof(int16_t);
    if (samples > 0) {
        (void)echo_audio_play((const int16_t *)pcm, samples, TTS_RATE_HZ);
    }
}

/* ---- event bus ---------------------------------------------------------- */

static void voice_on_tts_end(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    (void)base;
    (void)id;
    const echo_ha_tts_t *tts = (const echo_ha_tts_t *)data;

    (void)echo_audio_play_end();
    echo_wakeword_set_suppressed(false);

    if (tts != NULL && tts->follow_up) {
        ESP_LOGI(TAG, "follow-up turn requested");
        voice_begin_listen();
    }
}

static void voice_on_ha_status(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    (void)base;
    (void)id;
    const echo_ha_status_t *st = (const echo_ha_status_t *)data;
    if (st != NULL && !st->connected) {
        /* The link dropped: drop anything in flight so the next connection
         * starts from a clean state. */
        s_voice.listening = false;
        (void)echo_audio_capture_stop();
        (void)echo_audio_play_end();
        echo_wakeword_set_suppressed(false);
    }
}

/* ---- public API --------------------------------------------------------- */

esp_err_t echo_voice_init(void)
{
    if (s_voice.ready) {
        return ESP_OK;
    }
    if (!echo_audio_is_ready()) {
        return ESP_ERR_INVALID_STATE;
    }

    echo_ha_callbacks_t cbs = {
        .on_play_audio = voice_on_play_audio,
        .on_tts_audio = voice_on_tts_audio,
        .ctx = NULL,
    };
    echo_ha_set_callbacks(&cbs);

    esp_err_t err = echo_audio_set_monitor(voice_monitor, NULL);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "could not install the microphone tap: %s", esp_err_to_name(err));
        return err;
    }
    err = echo_wakeword_register_callback(voice_on_wake, NULL);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "could not register the wake callback: %s", esp_err_to_name(err));
        return err;
    }
    err = echo_event_bus_subscribe(ECHO_EVT_HA_TTS_END, voice_on_tts_end, NULL);
    if (err != ESP_OK) {
        return err;
    }
    err = echo_event_bus_subscribe(ECHO_EVT_HA_STATUS, voice_on_ha_status, NULL);
    if (err != ESP_OK) {
        return err;
    }

    s_voice.ready = true;
    ESP_LOGI(TAG, "voice loop ready (silence %d ms, max %d ms)", SILENCE_MS,
             UTTERANCE_MAX_MS);
    return ESP_OK;
}

bool echo_voice_ready(void)
{
    return s_voice.ready;
}

#else /* !CONFIG_ECHO_VOICE_ENABLED */

esp_err_t echo_voice_init(void) { return ESP_ERR_INVALID_STATE; }
bool      echo_voice_ready(void) { return false; }

#endif /* CONFIG_ECHO_VOICE_ENABLED */
