#include <ESP32HomeAssistant.h>

ESP32HomeAssistant* assistant = nullptr;

void setup() {
    Serial.begin(115200); 

    HAConfig cfg;
    cfg.apName = "CharlieEcho";    
    cfg.apPassword = "CharlieEcho123";
    cfg.I2S_MIC_WS = GPIO_NUM_11;
    cfg.I2S_MIC_SD = GPIO_NUM_12;
    cfg.I2S_MIC_SCK = GPIO_NUM_13;
    cfg.I2S_SPK_LRC = GPIO_NUM_4;
    cfg.I2S_SPK_BCLK = GPIO_NUM_5;
    cfg.I2S_SPK_DIN = GPIO_NUM_6;
    cfg.screenEnabled = true;

    delay(2000);
    assistant = new ESP32HomeAssistant(cfg);
    assistant->begin();
    
}

void loop() {
}

