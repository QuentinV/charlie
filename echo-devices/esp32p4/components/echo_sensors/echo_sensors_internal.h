/*
 * Internal interface between the echo_sensors facade and the two probe drivers.
 * Not part of the public component API.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/* DHT22 on a single GPIO (bit-banged). */
esp_err_t echo_sensor_dht22_start(void);
bool      echo_sensor_dht22_ready(void);
bool      echo_sensor_dht22_last(int32_t *milli_celsius, uint16_t *humidity_permille);

/* PAJ7620U2 on the display's I2C bus, INT line optional. */
esp_err_t echo_sensor_paj7620_start(void);
bool      echo_sensor_paj7620_ready(void);

#ifdef __cplusplus
}
#endif
