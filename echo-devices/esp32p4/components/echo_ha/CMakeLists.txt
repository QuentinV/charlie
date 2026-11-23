# echo_ha — Charlie-server WebSocket client (Home Assistant bridge).
#
# Ported from the Arduino libs/ESP32HomeAssistant library: same URL, same JSON
# commands, same "start"/PCM/"end" utterance upload. Audio is not built here; the
# app installs callbacks with echo_ha_set_callbacks().
#
# esp_websocket_client comes from the component registry and keeps its namespace
# prefix in the IDF build system, exactly like espressif__esp-tflite-micro in
# echo_wakeword. json is the core IDF cJSON component.

idf_component_register(
    SRCS "echo_ha.cpp"
    INCLUDE_DIRS "include"
    REQUIRES echo_core json esp_timer esp_app_format nvs_flash
    PRIV_REQUIRES "espressif__esp_websocket_client"
)
