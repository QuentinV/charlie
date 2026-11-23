/*
 * Charlie server protocol strings — lifted verbatim from the Arduino library's
 * README so the existing server keeps speaking the same dialect.
 *
 * Keep this header free of logic: it is the single place to edit when the server
 * protocol changes, and the one place to check when a device "does nothing".
 */
#pragma once

/* Device -> server, plain text markers around one utterance. */
#define ECHO_HA_MARK_START          "start"
#define ECHO_HA_MARK_END            "end"

/* JSON envelope. */
#define ECHO_HA_KEY_COMMAND         "c"
#define ECHO_HA_KEY_VALUE           "v"

/* Server -> device commands. */
#define ECHO_HA_CMD_PLAY_AUDIO      "playAudio"
#define ECHO_HA_CMD_WAKE_ACCURACY   "setWakeUpWordAccuracy"
#define ECHO_HA_CMD_SET_SERVER_IP   "setServerIp"
#define ECHO_HA_CMD_OTA             "OTA"
#define ECHO_HA_CMD_FEEDBACK        "feedback"
#define ECHO_HA_CMD_GET_VERSIONS    "getVersions"
#define ECHO_HA_CMD_UPDATE_DISPLAYS "updateDisplays"

/* Fields carried by playAudio / updateDisplays. */
#define ECHO_HA_KEY_CONVERSATION    "conversation"
#define ECHO_HA_KEY_TIMEOUT         "timeout"
#define ECHO_HA_KEY_SCREEN          "k"
#define ECHO_HA_KEY_TEXTS           "texts"

/* Device -> server versions payload. */
#define ECHO_HA_CMD_VERSIONS        "versions"
#define ECHO_HA_KEY_LIB             "lib"
#define ECHO_HA_KEY_DEVICE          "device"
#define ECHO_HA_KEY_TYPE            "type"
#define ECHO_HA_KEY_MAC             "mac"

/* WebSocket framing opcodes we care about (RFC 6455, section 5.2). */
#define ECHO_HA_OPCODE_CONTINUATION 0x00
#define ECHO_HA_OPCODE_TEXT         0x01
#define ECHO_HA_OPCODE_BINARY       0x02
#define ECHO_HA_OPCODE_CLOSE        0x08
#define ECHO_HA_OPCODE_PING         0x09
#define ECHO_HA_OPCODE_PONG         0x0A
