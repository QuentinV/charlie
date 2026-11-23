# echo_core — shared plumbing for Echo-Cook.
#
# Owns the FreeRTOS event bus, NVS-backed settings and the SPIFFS "storage"
# partition (UTF-8 recipe text). Every other component talks to the UI through
# the event bus instead of calling display drivers directly.

idf_component_register(
    SRCS "echo_event_bus.cpp"
         "echo_storage.cpp"
    INCLUDE_DIRS "include"
    REQUIRES esp_event nvs_flash spiffs esp_partition
)
