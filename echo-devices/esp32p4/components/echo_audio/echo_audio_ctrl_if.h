/*
 * Private bridge: the legacy-I2C audio_codec_ctrl_if_t implementation used by
 * echo_audio_codec.cpp. Kept out of include/ — it is an internal detail.
 */
#pragma once

#include <stdint.h>

#include "audio_codec_ctrl_if.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Build a control interface for a codec on an already-installed legacy port.
 *
 * @param port    I2C port number (the display driver's port 1 on this board).
 * @param addr7   Codec 7-bit address (0x18 for the ES8311).
 * @return Interface to pass as es8311_codec_cfg_t::ctrl_if, or NULL on OOM.
 */
const audio_codec_ctrl_if_t *echo_audio_i2c_ctrl_new(uint8_t port, uint8_t addr7);

#ifdef __cplusplus
}
#endif
