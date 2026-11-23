# echo_sensors — DHT22 temperature/humidity probe + PAJ7620U2 air gestures.
#
# Both drivers are self-contained: no managed component, no vendor SDK.
#  * DHT22     bit-banged on a GPIO (esp_timer + a short critical section)
#  * PAJ7620U2 I2C, reusing the port the JD9365 display driver installs, so
#              echo_display must be initialised first.

idf_component_register(
    SRCS "echo_sensors.cpp"
         "echo_sensor_dht22.cpp"
         "echo_sensor_paj7620.cpp"
    INCLUDE_DIRS "include"
    REQUIRES echo_core esp_driver_gpio esp_driver_i2c esp_timer
    # `driver` provides the legacy driver/i2c.h header the touch driver uses to
    # talk to the already-installed port; esp_driver_i2c alone does not expose it.
    PRIV_REQUIRES esp_hw_support driver
)
