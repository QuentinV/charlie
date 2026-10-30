# ESP32HomeAssistant

An ESP32 library for voice‑controlled Home Assistant devices with microphone (INMP441), speaker (MAX98357), OLED displays, NeoPixel LED, temperature/humidity sensor (AHT10/AHT20), and WebSocket communication to a Charlie server.

## Dependencies

This library depends on the following Arduino libraries (installable via PlatformIO or Arduino Library Manager):

- `WiFiManager` – WiFi configuration portal
- `WebSocketsClient` – WebSocket communication
- `ArduinoJson` – JSON parsing
- `Adafruit_NeoPixel` – LED control
- `Adafruit_GFX` – Graphics primitives
- `Adafruit_SSD1306` – OLED display driver
- `Adafruit_AHTX0` – Temperature/humidity sensor
- Edge Impulse inferencing library (`charlie-2_inferencing`) – wake word detection

## Configuration

All settings are defined through the `HAConfig` struct. Create an instance, set the desired fields, then pass it to the `ESP32HomeAssistant` constructor.

### `HAConfig` fields

| Field                   | Type                     | Default                  | Description                                                                                                                          |
| ----------------------- | ------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `apName`                | `const char*`            | `"HomeAssistantEcho"`    | WiFi AP SSID for the configuration portal                                                                                            |
| `apPassword`            | `const char*`            | `"HomeAssistantEcho123"` | WiFi AP password for the configuration portal                                                                                        |
| `deviceType`            | `const char*`            | `"echo-zero"`            | Device type identifier sent to the server (used for OTA firmware lookup)                                                             |
| `deviceVersion`         | `const char*`            | `"0.0.0"`                | Device firmware version reported to the server (semver)                                                                              |
| `WAKE_UP_WORD_ACCURACY` | `float`                  | `0.8f`                   | Minimum classification confidence threshold (0.0 – 1.0) to trigger recording                                                         |
| `overwriteServerip`     | `String`                 | empty                    | Override the saved server IP (avoids the need for the WiFi manager portal)                                                           |
| `neoPixelPin`           | `uint8_t`                | `GPIO_NUM_48`            | NeoPixel data pin                                                                                                                    |
| `neoPixelCount`         | `uint8_t`                | `1`                      | Number of NeoPixels in the chain                                                                                                     |
| `neoPixelBright`        | `uint8_t`                | `50`                     | NeoPixel brightness (0 – 255)                                                                                                        |
| `I2S_MIC_PORT`          | `i2s_port_t`             | `I2S_NUM_0`              | I2S peripheral number for the microphone                                                                                             |
| `I2S_MIC_WS`            | `gpio_num_t`             | `GPIO_NUM_17`            | Microphone WS (word select / LRCLK) pin                                                                                              |
| `I2S_MIC_SD`            | `gpio_num_t`             | `GPIO_NUM_18`            | Microphone SD (serial data) pin                                                                                                      |
| `I2S_MIC_SCK`           | `gpio_num_t`             | `GPIO_NUM_16`            | Microphone SCK (bit clock) pin                                                                                                       |
| `I2S_SPK_PORT`          | `i2s_port_t`             | `I2S_NUM_1`              | I2S peripheral number for the speaker                                                                                                |
| `I2S_SPK_LRC`           | `gpio_num_t`             | `GPIO_NUM_7`             | Speaker LRC (left/right clock) pin                                                                                                   |
| `I2S_SPK_BCLK`          | `gpio_num_t`             | `GPIO_NUM_6`             | Speaker BCLK (bit clock) pin                                                                                                         |
| `I2S_SPK_DIN`           | `gpio_num_t`             | `GPIO_NUM_5`             | Speaker DIN (data) pin                                                                                                               |
| `displays`              | `std::vector<I2CScreen>` | empty                    | List of OLED displays (see [`I2CScreen`](#i2cscreen-struct))                                                                         |
| `OLED_SDA`              | `gpio_num_t`             | `GPIO_NUM_17`            | I2C SDA pin for the OLED displays (used when `displays` is non‑empty)                                                                |
| `OLED_SCL`              | `gpio_num_t`             | `GPIO_NUM_18`            | I2C SCL pin for the OLED displays                                                                                                    |
| `TEMP_SDA`              | `gpio_num_t`             | `GPIO_NUM_41`            | I2C SDA pin for the temperature sensor                                                                                               |
| `TEMP_SCL`              | `gpio_num_t`             | `GPIO_NUM_42`            | I2C SCL pin for the temperature sensor                                                                                               |
| `feedbackScreenEnabled` | `bool`                   | `false`                  | Show server text feedback and listening animation on the first display                                                               |
| `tempSensorEnabled`     | `bool`                   | `false`                  | Enable the AHT10/AHT20 temperature/humidity sensor                                                                                   |
| `conversationTimeoutMs` | `uint32_t`               | `10000`                  | How long the device waits for the user to start a follow-up before returning to wake-word detection. Follow-ups are enabled by the server per turn. |
| `ttsMuteTailMs`         | `uint32_t`               | `300`                    | How long the microphone stays cut after a TTS reply finished playing (covers the I2S/DAC and room tail). |

### `I2CScreen` struct

Defines a single OLED display connected through the I2C bus (optionally via a TCA9548A multiplexer).

| Field     | Type      | Description                                                                        |
| --------- | --------- | ---------------------------------------------------------------------------------- |
| `w`       | `uint8_t` | Display width in pixels (e.g. 128)                                                 |
| `h`       | `uint8_t` | Display height in pixels (e.g. 32, 64)                                             |
| `r`       | `uint8_t` | Rotation in degrees (e.g. 0, 90)                                                   |
| `channel` | `uint8_t` | TCA9548A multiplexer channel (0 – 7). Ignored when only one display is configured. |

### Basic usage (single display, zero‑screen variant)

```cpp
#include <ESP32HomeAssistant.h>

ESP32HomeAssistant* assistant = nullptr;

void setup() {
    Serial.begin(115200);

    HAConfig cfg;
    cfg.apName         = "CharlieEcho";
    cfg.apPassword     = "CharlieEcho123";
    cfg.deviceType     = "echo-zero-screen";
    cfg.I2S_MIC_WS     = GPIO_NUM_11;
    cfg.I2S_MIC_SD     = GPIO_NUM_12;
    cfg.I2S_MIC_SCK    = GPIO_NUM_13;
    cfg.I2S_SPK_LRC    = GPIO_NUM_4;
    cfg.I2S_SPK_BCLK   = GPIO_NUM_5;
    cfg.I2S_SPK_DIN    = GPIO_NUM_6;
    cfg.OLED_SDA       = GPIO_NUM_1;
    cfg.OLED_SCL       = GPIO_NUM_2;
    cfg.feedbackScreenEnabled = true;
    cfg.WAKE_UP_WORD_ACCURACY = 0.65f;

    cfg.displays = {
        { 128, 32, 90, 0 }   // 128x32 screen, rotated 90°, TCA channel 0
    };

    delay(2000);
    assistant = new ESP32HomeAssistant(cfg);
    assistant->begin();
}

void loop() {
    // Everything is handled by FreeRTOS tasks
}
```

### Multi‑display usage (dashboard variant)

When using multiple displays connected through a TCA9548A I2C multiplexer, list each screen in the `displays` vector with its corresponding channel:

```cpp
#include <ESP32HomeAssistant.h>

ESP32HomeAssistant* assistant = nullptr;

void setup() {
    Serial.begin(115200);

    HAConfig cfg;
    cfg.apName         = "CharlieEcho";
    cfg.apPassword     = "CharlieEcho123";
    cfg.deviceType     = "echo-dashboard";
    cfg.I2S_MIC_WS     = GPIO_NUM_11;
    cfg.I2S_MIC_SD     = GPIO_NUM_12;
    cfg.I2S_MIC_SCK    = GPIO_NUM_13;
    cfg.I2S_SPK_LRC    = GPIO_NUM_4;
    cfg.I2S_SPK_BCLK   = GPIO_NUM_5;
    cfg.I2S_SPK_DIN    = GPIO_NUM_6;
    cfg.feedbackScreenEnabled = true;
    cfg.tempSensorEnabled      = true;
    cfg.WAKE_UP_WORD_ACCURACY  = 0.65f;

    cfg.displays = {
        { 128, 32, 90, 0 },   // feedback / clock display on TCA channel 0
        { 128, 64,  0, 1 },   // dashboard screen on TCA channel 1
        { 128, 64,  0, 2 },   // dashboard screen on TCA channel 2
        { 128, 64,  0, 3 },   // dashboard screen on TCA channel 3
        { 128, 64,  0, 4 }    // dashboard screen on TCA channel 4
    };

    delay(2000);
    assistant = new ESP32HomeAssistant(cfg);
    assistant->begin();
}

void loop() {
}
```

## Public API

### `ESP32HomeAssistant(const HAConfig& cfg)`

Constructor. Stores a copy of the configuration and sets the static singleton instance.

### `void begin()`

Initialises all hardware (NeoPixel, displays, temperature sensor, WiFi, I2S audio), starts the WebSocket connection, launches FreeRTOS tasks for microphone listening and screen updates, and synchronises time via NTP.

### `void setLed(uint8_t r, uint8_t g, uint8_t b)`

Sets the RGB colour of the NeoPixel LED.

### `void displayFeedback(String msg)`

Shows a text message centred on the first display (only if `feedbackScreenEnabled` is `true`).

### `void reset()`

Clears all saved preferences (WiFi credentials, server IP, wake word accuracy) and reboots the device.

### `void printMemoryUsage()`

Prints a memory usage report (internal free / min free, PSRAM free, task stack high water mark) to the serial console.

### `String getLibraryVersion() const`

Returns the version of the ESP32HomeAssistant library (the `ESP32HOMEASSISTANT_VERSION` macro, kept in sync with `library.properties`).

### `String getDeviceVersion() const`

Returns the device firmware version configured through `HAConfig::deviceVersion`.

### `String getDeviceMac() const`

Returns the MAC address of the WiFi station interface as a lowercase `aa:bb:cc:dd:ee:ff` string (from `WiFi.macAddress()`), or an empty string when the station is not connected. The server uses it as the **stable identity** of the device: the echo settings are keyed by MAC, so they follow the physical device when DHCP hands it another IP.

## WebSocket protocol

The device connects to `ws://{serverIp}:9303/ws/echo` and communicates using JSON commands. The server sends the following commands:

| Command                 | Payload                                       | Description                                          |
| ----------------------- | --------------------------------------------- | ---------------------------------------------------- |
| `playAudio`             | `{ "conversation": <bool> }`                  | Play the buffered audio; `conversation` asks the device to keep listening for a follow-up |
| `setWakeUpWordAccuracy` | `{ "v": <float> }`                            | Adjust wake word sensitivity                         |
| `setServerIp`           | `{ "v": "<ip>" }`                             | Change the Charlie server IP and reboot              |
| `OTA`                   | —                                             | Trigger over‑the‑air firmware update from the server |
| `feedback`              | `{ "v": "<text>" }`                           | Show text on the feedback display                    |
| `updateDisplays`        | `{ "v": [ { "k": <idx>, "texts": [...] } ] }` | Update individual screen contents                    |
| `getVersions`           | —                                             | Device replies with the `versions` payload           |

The device sends:

- `"start"` (text) – begins an audio upload
- Binary audio data – 16‑bit PCM samples at the model's sampling rate
- `"end"` (text) – signals the end of the audio upload
- `{"c":"versions","v":{"lib":"<version>","device":"<version>","type":"<deviceType>","mac":"<mac>"}}` (text): sent automatically on every connect, reports the library and device firmware versions plus the MAC address used by the server to identify the device

## Versioning

Two independent versions are reported to the server:

- Library version: the `ESP32HOMEASSISTANT_VERSION` macro in `ESP32HomeAssistant.h`, kept in sync with the `version` field in `library.properties`.
- Device version: `HAConfig::deviceVersion`, set by each entry point (`src/main_*.cpp`).

Both follow semantic versioning (`MAJOR.MINOR.PATCH`). The device sends its `versions` message automatically on every WebSocket connect, so the server can detect which firmware a device runs and push the matching OTA update; sending `{ "c": "getVersions" }` asks for the same payload on demand. The message also carries the MAC address (`mac`) reported by `getDeviceMac()`, which the server stores as the identity of the device: settings keyed by MAC survive an IP change, while the IP stays the transport address of the WebSocket connection.

```json
{ "c": "versions", "v": { "lib": "1.2.0", "device": "1.0.0", "type": "echo-zero", "mac": "aa:bb:cc:dd:ee:ff" } }
```

## Conversation mode

Conversation mode is **driven by the server** – there is no device flag. Each turn, the server appends a `conversation` boolean to the `playAudio` command:

```json
{ "c": "playAudio", "conversation": true }   // keep the microphone open
{ "c": "playAudio", "conversation": false }  // return to wake‑word mode
```

1. The wake word ("charlie") is detected locally and the utterance is recorded and sent; the device then goes back to wake‑word detection.
2. The assistant's reply is received and played back. When playback finishes, the device checks the `conversation` flag.
3. If the server asked for a follow‑up, the device re‑opens the microphone (LED white) **without requiring the wake word again**.
4. If the user starts speaking, the follow‑up utterance is recorded and sent, and the cycle repeats with the server deciding again whether to continue.
5. If no speech is detected within `conversationTimeoutMs`, the window closes (LED off) and the device returns to wake‑word detection.

The Charlie server sets the flag from the assistant's answer: when the reply is a question (ends with `?`), it keeps the conversation open – this also covers the voice‑profile registration prompts. It also keeps one LLM session per connection, so follow‑ups have memory across turns.

## Microphone muting during playback

The microphone would otherwise pick up the speaker and feed the assistant's own voice back into the wake‑word detector (and into the follow‑up detection), which makes the device talk to itself in an endless loop. To prevent this the microphone is **cut for the whole TTS turn**:

1. On the first audio chunk of a reply (`WStype_BIN`) the microphone is muted – samples are still read from I2S so the DMA never overflows, but they are discarded.
2. Playback keeps the mute engaged until `i2s_write()` returned **and** `ttsMuteTailMs` has elapsed, so the DAC and the acoustic tail are covered too.
3. When the mute is released the inference buffers are zeroed and a full clean 1 s window is captured before wake‑word detection runs again; the conversation timeout restarts at that point as well.
4. A dropped WebSocket resets the mute, so the microphone can never stay cut after a failed stream.

Muting is entirely software based – the I2S RX driver keeps running, which keeps the DMA drained and avoids stopping a driver that another task is blocking on. The LED stays purple while a reply is received / played.

## Persisted settings (Preferences)

The library stores the following values in NVS namespace `config`:

| Key            | Type   | Description                                                                      |
| -------------- | ------ | -------------------------------------------------------------------------------- |
| `serverIp`     | String | Charlie server IP address (set via the WiFi portal or the `setServerIp` command) |
| `wordAccuracy` | float  | Wake word accuracy threshold (set via the `setWakeUpWordAccuracy` command)       |

## Startup behaviour

1. Initialise NeoPixel (green = booting)
2. Initialise displays and temperature sensor
3. Start the WiFi configuration portal (if no credentials are saved) or connect automatically
4. Ask for a Charlie server IP (via the portal parameter field or from saved preferences)
5. Allocate inference and audio buffers (PSRAM)
6. Initialise speaker and microphone I2S
7. Synchronise time via NTP (timezone: Europe/Paris)
8. Blue LED = ready
9. Launch WebSocket task (core 0) and audio/listen task (core 1)
10. If `feedbackScreenEnabled` – launch the clock/screen update task

## LED status colours

| Colour         | Meaning                                 |
| -------------- | --------------------------------------- |
| Green          | Booting                                 |
| Blue           | Ready, waiting for WebSocket connection |
| Red            | Not connected to WebSocket              |
| Purple (flash) | Sending audio / receiving or playing a TTS reply (microphone muted) |
| White          | Wake word detected, recording audio     |
| Cyan           | OTA update in progress                  |
| Off            | Idle (no activity)                      |
