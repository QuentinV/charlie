# Echo main

## Components

- ESP32-S3 WROOM N16R8 CAM OV5640
- OLED IIC 128x64 I2C SSD1306 12864

- HR-SR501 (movement sensor)
- DHT22 (temp sensor)
- touch button TTP223

- Microphone INMP441
- MAX98357 audio
- 8 Ohm 3W 8R 40MM 5.5MM

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
