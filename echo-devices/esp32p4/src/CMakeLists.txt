# This file was automatically generated for projects
# without default 'CMakeLists.txt' file.
#
# Manually adjusted (PlatformIO only regenerates this file when it is missing):
#  * only real source extensions are globbed, so that idf_component.yml and other
#    non-compilable files in src/ are not passed to idf_component_register().
#  * REQUIRES lists the managed JD9365 driver and its dependencies explicitly.
#  * echo_core / echo_display / echo_wifi / echo_ha / echo_sensors are the
#    Echo-Cook infrastructure components; the app only talks to them (event bus,
#    storage, panel bring-up, network, sensors), never to raw drivers or sockets.

FILE(GLOB_RECURSE app_sources
     ${CMAKE_SOURCE_DIR}/src/*.c
     ${CMAKE_SOURCE_DIR}/src/*.cpp
     ${CMAKE_SOURCE_DIR}/src/*.cc
     ${CMAKE_SOURCE_DIR}/src/*.cxx
     ${CMAKE_SOURCE_DIR}/src/*.S)

idf_component_register(SRCS ${app_sources}
                       INCLUDE_DIRS "."
                       REQUIRES esp_lcd_jd9365_10_1 esp_lcd esp_driver_gpio
                                esp_partition
                                echo_wakeword echo_core echo_display echo_ui
                                echo_screen echo_wifi echo_ha echo_sensors
                                echo_audio echo_voice echo_status)
