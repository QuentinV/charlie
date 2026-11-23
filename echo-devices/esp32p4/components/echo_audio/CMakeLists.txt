# echo_audio — onboard microphone + speaker path (ES8311 codec + NS4150B PA).
#
# Self-contained I2S bring-up: the full-duplex std channel (MCLK/BCLK/WS/DOUT/DIN)
# is created here, the ES8311 is configured over the display's shared *legacy* I2C
# port (echo_audio_i2c_ctrl.cpp), and the NS4150B amplifier enable (PA_CTRL) is
# driven directly.
#
# Codec register init / volume / mic gain come from espressif/esp_codec_dev
# (registry component, keeps its namespace prefix "espressif__esp_codec_dev"),
# declared in src/idf_component.yml.

idf_component_register(
    SRCS "echo_audio.cpp" "echo_audio_codec.cpp" "echo_audio_i2c_ctrl.cpp"
    INCLUDE_DIRS "include"
    REQUIRES echo_core esp_timer esp_driver_gpio esp_driver_i2s esp_driver_i2c
    # `driver` provides the legacy driver/i2c.h header the display driver installs
    # the shared port with; esp_driver_i2c alone does not expose it.
    PRIV_REQUIRES driver "espressif__esp_codec_dev"
)
