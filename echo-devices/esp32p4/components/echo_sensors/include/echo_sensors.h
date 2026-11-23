/*
 * Echo-Cook on-board sensors.
 *
 * Two independent probes, each started by echo_sensors_init() when enabled in
 * menuconfig, each publishing onto the default event loop:
 *
 *   DHT22      temperature + humidity on a single GPIO (bit-banged 1-wire)
 *              -> ECHO_EVT_TEMPERATURE, payload echo_temperature_t
 *   PAJ7620U2  air gestures over I2C, INT line on a GPIO
 *              -> ECHO_EVT_AIR_GESTURE, payload echo_air_gesture_t
 *
 * Neither driver draws anything or blocks the caller: both run in their own
 * task and the public getters only read a cached sample. A missing or dead
 * sensor therefore costs one log line at boot, never a failed boot.
 *
 * I2C note: the PAJ7620U2 shares the bus that the Waveshare JD9365 driver
 * installs on I2C_NUM_1 (SDA=GPIO7, SCL=GPIO8), the same bus the touch
 * controller uses. echo_sensors_init() must run after echo_display_init();
 * it never installs a driver of its own.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Start every sensor enabled in menuconfig (echo_sensors).
 *
 * Returns the first error, but a failing sensor does not stop the others.
 */
esp_err_t echo_sensors_init(void);

/** @brief True when the temperature task is polling a probe that answered. */
bool echo_sensors_temperature_ready(void);

/** @brief True when the gesture task found a PAJ7620U2 and started polling. */
bool echo_sensors_gesture_ready(void);

/**
 * @brief Read the last good temperature sample without blocking.
 *
 * @param[out] milli_celsius      Temperature in 1/1000 degC (21500 = 21.5 degC).
 * @param[out] humidity_permille  Relative humidity in 1/1000 (65500 = 65.5 %).
 * @return false when no valid sample has been read yet; the outputs are then
 *         left untouched.
 */
bool echo_sensors_temperature_last(int32_t *milli_celsius, uint16_t *humidity_permille);

#ifdef __cplusplus
}
#endif
