/*
 * echo_audio internal contract between the facade (echo_audio.cpp) and the codec
 * bring-up (echo_audio_codec.cpp). Not installed for other components: include it
 * with a relative path only from inside echo_audio/.
 *
 * Every function here is single-threaded by contract: the caller (the facade)
 * holds its I/O lock across each call, so the codec is only ever touched by one
 * task at a time.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/** @brief I2S + ES8311 + PA GPIO bring-up (no data flowing yet). */
esp_err_t echo_audio_platform_init(void);

/** @brief True when the codec answered and the deinitialisation handle exists. */
bool echo_audio_platform_ready(void);

/** @brief Open the codec at @p sample_rate_hz, reconfiguring I2S when the rate changes. */
esp_err_t echo_audio_platform_open(uint32_t sample_rate_hz);

/** @brief Close the codec (stops the I2S clocks). */
esp_err_t echo_audio_platform_close(void);

/** @brief Blocking read of @p frames interleaved stereo (left = microphone) frames. */
esp_err_t echo_audio_platform_read(int16_t *stereo, size_t frames);

/** @brief Blocking write of @p frames interleaved stereo frames. */
esp_err_t echo_audio_platform_write(const int16_t *stereo, size_t frames);

/** @brief Output volume, 0-100. */
void echo_audio_platform_set_volume(int volume_0_100);

/** @brief Microphone gain in dB. */
void echo_audio_platform_set_mic_gain(int db);

/** @brief Amplifier enable line (active high). */
void echo_audio_platform_pa(bool on);

#ifdef __cplusplus
}
#endif
