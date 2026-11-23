# echo_ui — LVGL 9 plumbing for Echo-Cook.
#
# Two displays (10.1" DSI + 3.5" SPI) share one LVGL instance. The port talks to
# echo_display's RGB565 blit API, so this component does not depend on
# esp_lvgl_port and does not touch panel drivers directly.
#
# This component owns the displays, the touch indev, the UI task and the
# "waiting for UI" fallback. The application UI itself is built by echo_screen
# from the bundle Charlie serves; nothing here knows the bundle format.
#
# The fonts are generated from LVGL's bundled DejaVuSans.ttf (see fonts/README.md)
# and cover Latin-1 so French accents render.

idf_component_register(
    SRCS "echo_ui.cpp"
         "fonts/echo_font_12.c"
         "fonts/echo_font_16.c"
         "fonts/echo_font_20.c"
         "fonts/echo_font_28.c"
         "fonts/echo_font_40.c"
         "fonts/echo_font_56.c"
    INCLUDE_DIRS "include"
    REQUIRES lvgl echo_display echo_core esp_timer heap
)