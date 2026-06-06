# Echo zero

## Components

- ESP32-S3 WROOM N16R8

- Microphone INMP441
- MAX98357 audio
- 8 Ohm 3W 8R 40MM 5.5MM

# Bord definition

Move [board file](boards/esp32-s3-devkitc-1-n16r8v.json) to your user folder in

> .platformio\platforms\espressif32\boards

![board](docs/board.jpg)

## ESP32HomeAssistant library

The library created to interact with Charlie server.
[README Documentation here](./libs/ESP32HomeAssistant/README.md)

## Websocket api commands through JSON

```json
{ "c": "playAudio" } // Play already received audio
{ "c": "setWakeUpWordAccuracy", "v": "0.60" }
{ "c": "setServerIp", "v": "192.168.1.2" }
{ "c": "OTA" } // trigger remote update
{ "c": "feedback", "v": "Text" } // Text feedback from server
{
    "c": "updateDisplays",
    "v": [
        {
            "k": 0, // key depends on how many screens are available
            "texts": [ {
                "ts": 1,  // text size
                "v": "Hello",  // text
                "cx": 0, // cursor x position
                "cy": 0, // cursor y position
                "r": 0    // rotation
            }]
        }
    ]
}
```

# Versions

View the changelog here: [changelog.json](./changelog.json)
