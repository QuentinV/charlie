/*
 * echo_sensors facade: start every probe enabled in menuconfig and report the
 * result. Each driver owns its own task, so a sensor that is missing, unplugged
 * or fails to initialise only produces a log line — boot always continues.
 *
 * Call order matters for the gesture sensor: it shares the I2C port that the
 * Waveshare JD9365 driver installs during echo_display_init(), so app_main()
 * must initialise the display first.
 */
#include "echo_sensors.h"

#include "esp_log.h"
#include "sdkconfig.h"

#include "echo_sensors_internal.h"

static const char *TAG = "echo_sensors";

esp_err_t echo_sensors_init(void)
{
    esp_err_t first_error = ESP_OK;

#ifdef CONFIG_ECHO_SENSORS_DHT22_ENABLED
    {
        const esp_err_t err = echo_sensor_dht22_start();
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "temperature probe unavailable: %s", esp_err_to_name(err));
            first_error = err;
        }
    }
#endif

#ifdef CONFIG_ECHO_SENSORS_PAJ7620_ENABLED
    {
        const esp_err_t err = echo_sensor_paj7620_start();
        if (err != ESP_OK) {
            /* ESP_ERR_NOT_FOUND is the common case: the sensor is optional. */
            ESP_LOGW(TAG, "gesture sensor unavailable: %s", esp_err_to_name(err));
            if (first_error == ESP_OK) {
                first_error = err;
            }
        }
    }
#endif

    ESP_LOGI(TAG, "temperature: %s, gesture: %s",
             echo_sensors_temperature_ready() ? "up" : "down",
             echo_sensors_gesture_ready() ? "up" : "down");
    return first_error;
}

bool echo_sensors_temperature_ready(void)
{
    return echo_sensor_dht22_ready();
}

bool echo_sensors_gesture_ready(void)
{
    return echo_sensor_paj7620_ready();
}

bool echo_sensors_temperature_last(int32_t *milli_celsius, uint16_t *humidity_permille)
{
    return echo_sensor_dht22_last(milli_celsius, humidity_permille);
}
