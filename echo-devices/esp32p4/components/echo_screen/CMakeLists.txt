# echo_screen — screen bundle renderer for Echo-Cook.
#
# Pulls the UI bundle from Charlie over HTTP, caches it in SPIFFS, parses it
# with cJSON and renders it with LVGL. All LVGL calls happen on the UI task via
# the echo_ui service hook; the HTTP fetch runs on its own task.
#
# Contract: components/echo_screen/include/echo_screen_schema.h (mirror of
# charlie/nodejs-apis/src/echo/ui/schema.ts).

idf_component_register(
    SRCS "echo_screen.cpp"
         "echo_screen_bundle.cpp"
         "echo_screen_fetch.cpp"
         "echo_screen_vars.cpp"
         "echo_screen_bind.cpp"
         "echo_screen_render.cpp"
         "echo_screen_actions.cpp"
    INCLUDE_DIRS "include"
    PRIV_INCLUDE_DIRS "."
    REQUIRES lvgl echo_ui echo_core echo_display echo_ha json esp_http_client
)
