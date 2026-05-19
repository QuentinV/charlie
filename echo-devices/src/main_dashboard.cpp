#include <ESP32HomeAssistant.h>

ESP32HomeAssistant* assistant = nullptr;

void setup() {
    Serial.begin(115200); 

    HAConfig cfg;
    cfg.apName = "CharlieEcho";    
    cfg.apPassword = "CharlieEcho123";
    cfg.deviceType = "echo-dashboard";
    cfg.I2S_MIC_WS = GPIO_NUM_11;
    cfg.I2S_MIC_SD = GPIO_NUM_12;
    cfg.I2S_MIC_SCK = GPIO_NUM_13;
    cfg.I2S_SPK_LRC = GPIO_NUM_4;
    cfg.I2S_SPK_BCLK = GPIO_NUM_5;
    cfg.I2S_SPK_DIN = GPIO_NUM_6;
    cfg.feedbackScreenEnabled = true;
    cfg.tempSensorEnabled = true;
    cfg.WAKE_UP_WORD_ACCURACY = 0.65f;

    cfg.displays = { 
        { 1, 2, 128, 32 }
        ,{ 8, 7, 128, 64 }, 
        { 10, 9, 128, 64 },
        //{ 21, 47, 128, 64 },
        { 42, 41, 128, 64 }
    };

    delay(2000);
    assistant = new ESP32HomeAssistant(cfg);
    assistant->begin();
}

void loop() {
}

