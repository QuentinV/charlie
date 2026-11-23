# echo_display — dual-panel bring-up for Echo-Cook.
#
#  * MAIN: Waveshare 10.1" DSI panel (JD9365, 800x1280, RGB888) — touch capable.
#  * AUX : generic 3.5" SPI TFT, 480x320 — ST7796 (RGB565) or ILI9488 (RGB666),
#          selected in Kconfig. Output only.
#
# The component only owns the panels and raw pixel blitting. Screen composition
# (LVGL) is layered on top later; P0 just needs both panels alive and painting.

idf_component_register(
    SRCS "echo_display.cpp"
         "echo_display_dsi.cpp"
         "echo_display_spi.cpp"
         "echo_display_touch.cpp"
    INCLUDE_DIRS "include"
    REQUIRES esp_lcd esp_lcd_jd9365_10_1 esp_driver_gpio esp_driver_spi
             esp_driver_i2c echo_core
    PRIV_REQUIRES esp_hw_support
)
