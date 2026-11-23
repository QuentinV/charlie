# echo_wakeword — "Hey Charlie" wake word policy layer.
#
# The policy code (buffering, threshold, cooldown, dispatch) is always built. The model
# engine is optional: enable CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED in menuconfig and drop the
# trained engine implementation into engines/ (see README.md). Without it the component
# compiles and runs in buffer-only mode.

set(ww_sources "echo_wakeword.cpp")
set(ww_requires esp_timer)

if(CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED)
    set(ww_engine_source "${CMAKE_CURRENT_LIST_DIR}/engines/tflite_engine.cpp")
    if(NOT EXISTS "${ww_engine_source}")
        message(FATAL_ERROR
            "CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED is set but engines/tflite_engine.cpp is "
            "missing. Either add the trained 'hey_charlie' engine there or disable "
            "CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED (menuconfig -> echo_wakeword).")
    endif()
    list(APPEND ww_sources "engines/tflite_engine.cpp")
    # Managed components from the registry keep their namespace prefix in the IDF build
    # system ("espressif__esp-tflite-micro"), while esp_partition is a core IDF component.
    # The registry entries themselves are declared in src/idf_component.yml.
    list(APPEND ww_requires
        "espressif__esp-tflite-micro"
        "espressif__esp-dsp"
        "esp_partition"
    )
endif()

idf_component_register(
    SRCS ${ww_sources}
    INCLUDE_DIRS "include"
    PRIV_REQUIRES ${ww_requires}
)

if(CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED)
    # The PlatformIO/ESP-IDF integration used here resolves PRIV_REQUIRES at link time but
    # does not propagate the dependency include directories into this component's own
    # compile commands. Add them explicitly so tflite_engine.cpp sees the TFLite-Micro,
    # esp-dsp and esp_partition headers. Paths mirror each component's INCLUDE_DIRS.
    set(ww_managed "${CMAKE_CURRENT_LIST_DIR}/../../managed_components")
    target_include_directories(${COMPONENT_LIB} PRIVATE
        "${ww_managed}/espressif__esp-tflite-micro"
        "${ww_managed}/espressif__esp-tflite-micro/third_party/flatbuffers/include"
        "${ww_managed}/espressif__esp-tflite-micro/third_party/gemmlowp"
        "${ww_managed}/espressif__esp-tflite-micro/third_party/ruy"
        "${ww_managed}/espressif__esp-tflite-micro/third_party/kissfft"
        "${ww_managed}/espressif__esp-dsp"
        "${ww_managed}/espressif__esp-dsp/modules/fft/include"
        "${ww_managed}/espressif__esp-dsp/modules/common/include"
        "${IDF_PATH}/components/esp_partition/include"
        "${IDF_PATH}/components/heap/include"
        "${IDF_PATH}/components/log/include"
    )
endif()
