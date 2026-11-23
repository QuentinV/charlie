/*
 * echo_voice — the "Hey Charlie" conversation loop for the echo-cook device.
 *
 * Glue only: echo_audio owns the microphone and speaker, echo_wakeword owns the
 * detection policy and echo_ha owns the Charlie protocol. This component decides
 * what happens between them:
 *
 *   capture (continuous)  -> echo_wakeword_feed()
 *   wake word detected    -> post ECHO_EVT_WAKE_WORD, "start", record, "end"
 *   playAudio received    -> suppress detection, play TTS, handle follow-up
 *
 * Nothing here blocks: every hop is either a queue push (echo_audio_play) or a
 * short WebSocket send.
 */
#pragma once

#include <stdbool.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Start the conversation loop. Idempotent.
 *
 * Requires echo_wakeword_init() and echo_audio_start() to have run and
 * echo_audio_is_ready() to be true; returns ESP_ERR_INVALID_STATE otherwise.
 */
esp_err_t echo_voice_init(void);

/** @brief True once the loop is wired up. */
bool echo_voice_ready(void);

#ifdef __cplusplus
}
#endif
