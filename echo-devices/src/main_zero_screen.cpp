#include <ESP32HomeAssistant.h>

#define DEVICE_VERSION "1.0.0"

ESP32HomeAssistant* assistant = nullptr;

void setup() {
    Serial.begin(115200); 

    HAConfig cfg;
    cfg.apName = "CharlieEcho";    
    cfg.apPassword = "CharlieEcho123";
    cfg.deviceType = "echo-zero-screen";
    cfg.deviceVersion = DEVICE_VERSION;
    cfg.I2S_MIC_WS = GPIO_NUM_11;
    cfg.I2S_MIC_SD = GPIO_NUM_12;
    cfg.I2S_MIC_SCK = GPIO_NUM_13;
    cfg.I2S_SPK_LRC = GPIO_NUM_4;
    cfg.I2S_SPK_BCLK = GPIO_NUM_5;
    cfg.I2S_SPK_DIN = GPIO_NUM_6;
    cfg.OLED_SDA = GPIO_NUM_1;
    cfg.OLED_SCL = GPIO_NUM_2;
    cfg.feedbackScreenEnabled = true;
    cfg.displayScreenTime = true;
    cfg.WAKE_UP_WORD_ACCURACY = 0.65f;

    I2CScreen o1;
    o1.w = 128; o1.h = 32; o1.r = 90; o1.channel = 0;
    cfg.displays = { o1 };


    delay(2000);
    assistant = new ESP32HomeAssistant(cfg);
    assistant->begin();
    
}

void loop() {
}

