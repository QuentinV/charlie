# echo_status — boot diagnostics screen for Echo-Cook.
#
# A one-shot task that waits for the boot to settle and then paints a status
# page (free RAM/PSRAM, Wi-Fi, time, sensors, panels, microphone/speaker) on the
# 10.1" panel plus a welcome message on the 3.5" panel. It reuses echo_ui's LVGL
# lock, displays and fonts and hands the screen back to echo_screen afterwards,
# so it is a sibling of the bundle renderer rather than a second UI owner.

idf_component_register(
    SRCS "echo_status.cpp"
    INCLUDE_DIRS "include"
    REQUIRES lvgl echo_ui echo_core echo_display echo_screen
             echo_wifi echo_sensors echo_audio echo_wakeword echo_ha
             esp_timer heap
)
