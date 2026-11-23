/*
 * echo_audio — onboard microphone + speaker path for the echo-cook device.
 *
 * The ESP32-P4-WIFI6 carries an ES8311 mono codec (analog microphone on its ADC,
 * speaker on its DAC) and an NS4150B power amplifier. This component owns the
 * whole audio path:
 *
 *   I2S std full-duplex (MCLK/BCLK/WS/DOUT/DIN)   -> the data bus
 *   ES8311 over the display's shared I2C port     -> register init, volume, gain
 *   GPIO53 (PA_CTRL, active high)                 -> amplifier enable
 *
 * It deliberately knows nothing about the wake word or the Charlie server: it
 * captures 16 kHz mono and hands the PCM to whoever registered a callback.
 *
 *   echo_audio_set_monitor()        continuous 16 kHz mono tap (wake word)
 *   echo_audio_capture_start()      one utterance, delivered to a sink until stop
 *   echo_audio_play()               stream 16-bit mono PCM to the speaker
 *
 * echo_audio does not install an I2C driver: the Waveshare JD9365 display driver
 * installs the legacy port 1 (SDA=GPIO7 / SCL=GPIO8) and never releases it, so
 * echo_audio_init() must run after echo_display_init(), exactly like echo_sensors.
 *
 * All public calls are safe to make from any task. The monitor and sink callbacks
 * run on the capture task: copy the PCM and return quickly (an echo_ha_send_* of
 * one chunk is fine, a blocking network round-trip is not).
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief PCM callback. @p pcm is 16-bit mono at ECHO_AUDIO_SAMPLE_RATE_HZ (16 kHz).
 */
typedef void (*echo_audio_pcm_cb_t)(const int16_t *pcm, size_t samples, void *ctx);

/**
 * @brief Bring up I2S, the ES8311 and the PA. Idempotent.
 *
 * Must run after echo_display_init() (shared I2C port). Returns ESP_ERR_NOT_FOUND
 * when the codec does not answer, which is reported but not fatal.
 */
esp_err_t echo_audio_init(void);

/** @brief Start the capture task (and the playback task). Requires echo_audio_init(). */
esp_err_t echo_audio_start(void);

/** @brief Stop both tasks, close the codec and drop the PA. */
esp_err_t echo_audio_stop(void);

/** @brief True once the codec is initialised. */
bool echo_audio_is_ready(void);

/**
 * @brief Install the continuous monitor tap (the wake word feeds from this).
 *
 * Passing NULL removes the tap. Only one tap is supported; the last one wins.
 */
esp_err_t echo_audio_set_monitor(echo_audio_pcm_cb_t cb, void *ctx);

/**
 * @brief Record one utterance and deliver it to @p sink until stopped.
 *
 * Replaces any monitor-driven wake word use with an utterance tap. @p max_ms is a
 * safety cap (0 = no cap); echo_voice normally stops the capture earlier on
 * silence. The sink runs on the capture task.
 */
esp_err_t echo_audio_capture_start(echo_audio_pcm_cb_t sink, void *ctx, uint32_t max_ms);

/** @brief Stop an utterance capture (no-op when none is running). */
esp_err_t echo_audio_capture_stop(void);

/** @brief True while an utterance capture is running. */
bool echo_audio_capture_active(void);

/**
 * @brief Stream 16-bit mono PCM to the speaker.
 *
 * @p sample_rate_hz may differ from the capture rate (the server's TTS is
 * 22050 Hz): the codec and I2S are reconfigured around the playback and restored
 * to the capture rate afterwards. Non-blocking in practice — the data is queued
 * to a playback task, so call it from the WebSocket callback.
 */
esp_err_t echo_audio_play(const int16_t *pcm, size_t samples, uint32_t sample_rate_hz);

/** @brief End the current playback turn (drop the PA once the queue drains). */
esp_err_t echo_audio_play_end(void);

/**
 * @brief Play a short synthesised tone on the speaker.
 *
 * Generates a fade-in/out sine at ECHO_AUDIO_SAMPLE_RATE_HZ and queues it exactly
 * like echo_audio_play(), then ends the turn. Used as a speaker self-test / user
 * feedback (echo_status plays a two-note chime at boot). Non-blocking; requires
 * echo_audio_init() and echo_audio_start() to have run.
 */
esp_err_t echo_audio_play_tone(uint16_t freq_hz, uint32_t duration_ms);

/** @brief True while a playback turn is running. */
bool echo_audio_playback_active(void);

/** @brief Drive the amplifier enable line directly (ignored when PA_GPIO is -1). */
void echo_audio_pa_enable(bool on);

#ifdef __cplusplus
}
#endif
