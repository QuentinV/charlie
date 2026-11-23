# echo_voice — wake word + microphone + Charlie upload orchestration.
#
# Ties three otherwise independent components together without any of them
# knowing about the others:
#   echo_audio     captures 16 kHz mono and plays the server's TTS
#   echo_wakeword  scores the audio and reports "Hey Charlie"
#   echo_ha        uploads an utterance ("start" / PCM / "end") and streams TTS
#
# This is the only place that owns the "listen then answer" state machine, so
# main.cpp stays a plain wire-up.

idf_component_register(
    SRCS "echo_voice.cpp"
    INCLUDE_DIRS "include"
    REQUIRES echo_core echo_audio echo_wakeword echo_ha esp_timer
)
