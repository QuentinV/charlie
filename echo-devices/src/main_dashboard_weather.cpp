#include <ESP32HomeAssistant.h>

#define DEVICE_VERSION "1.0.0"

ESP32HomeAssistant* assistant = nullptr;

void setup() {
    Serial.begin(115200); 

    while (!Serial) { 
        delay(10); 
    }

    HAConfig cfg;
    cfg.apName = "CharlieEcho";    
    cfg.apPassword = "CharlieEcho123";
    cfg.deviceType = "echo-dashboard-weather";
    cfg.deviceVersion = DEVICE_VERSION;
    cfg.I2S_MIC_WS = GPIO_NUM_11;
    cfg.I2S_MIC_SD = GPIO_NUM_12;
    cfg.I2S_MIC_SCK = GPIO_NUM_13;
    cfg.I2S_SPK_LRC = GPIO_NUM_4;
    cfg.I2S_SPK_BCLK = GPIO_NUM_5;
    cfg.I2S_SPK_DIN = GPIO_NUM_6;
    cfg.feedbackScreenEnabled = true;
    cfg.displayScreenTime = true;
    cfg.WAKE_UP_WORD_ACCURACY = 0.65f;
    cfg.tempSensorEnabled = false;

    I2CScreen o1;
    o1.w = 128; o1.h = 32; o1.r = 90; o1.channel = 0;
    I2CScreen o2;
    o2.w = 128; o2.h = 64; o2.channel = 1;
    I2CScreen o3;
    o3.w = 128; o3.h = 64; o3.channel = 2;
    I2CScreen o4;
    o4.w = 128; o4.h = 160; o4.sda = GPIO_NUM_2; o4.scl = GPIO_NUM_10; 
    o4.cs = GPIO_NUM_1; o4.dc = GPIO_NUM_16; o4.rst = GPIO_NUM_15;
    o4.tft = true;
    cfg.displays = { o1, o2, o3, o4 };
    
    delay(2000);
    assistant = new ESP32HomeAssistant(cfg);
    assistant->begin();
}                                                                   

void loop() {
}

