# Components

-   ESP32-S3 WROOM N16R8 CAM OV5640
-   OLED IIC 128x64 I2C SSD1306 12864

-   HR-SR501 (movement sensor)
-   DHT22 (temp sensor)
-   touch button TTP223

-   Microphone INMP441
-   MAX98357 audio
-   8 Ohm 3W 8R 40MM 5.5MM

# Bord definition

Move [board file](boards/esp32-s3-devkitc-1-n16r8v.json) to your user folder in

> .platformio\platforms\espressif32\boards

![board](docs/board.jpg)

# Flow

:::mermaid
flowchart TB
subgraph "ESP32 / Echo device"
    StateReporting
    TouchSensor
    MotionSensor
    ReceivePlayAudio["Receive and play<br/>audio on speaker"]
    Commands["MQTT server<br/> commands"]

    subgraph ListenWakeUpWordTask
        IsMute{Is mute?}
        ListenWakeUpWord
        WakeUpWordDetected
        StopAudioCapture
        RecordAudio

        IsMute -->|no| ListenWakeUpWord
        ListenWakeUpWord --> WakeUpWordDetected
        WakeUpWordDetected --> StopAudioCapture
        StopAudioCapture --> RecordAudio
        RecordAudio --> IsMute
    end

    StateReporting -->|Every 30 min| FetchSensorData["Fetch sensor data<br/>Temp, Humidity"]
    FetchSensorData --> SendMQTT

    MotionSensor <--> FetchSensorData
    MotionSensor --> DisplayInfoScreen["Display info<br/>on screen"]

    TouchSensor --> Mute
    Commands --> Mute
    Commands --> TurnOnCamera
    TurnOnCamera --> RecordVideo
end
subgraph Server
    UDPAudioServer
    STT
    LLM
    TTS

    UDPVideoServer

    MQTTServer
    DB[(DB)]

    MQTTServer --> |Insert states| DB
    UDPAudioServer --> STT
    STT --> LLM
    LLM --> TTS
end

SendMQTT --> MQTTServer
RecordAudio --> UDPAudioServer
TTS --> ReceivePlayAudio
RecordVideo --> UDPVideoServer
:::
