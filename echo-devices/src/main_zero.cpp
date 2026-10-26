#include <ESP32HomeAssistant.h>

#define DEVICE_VERSION "1.0.0"

ESP32HomeAssistant* assistant = nullptr;

void setup() {
    Serial.begin(115200); 

    HAConfig cfg;
    cfg.apName = "CharlieEcho";    
    cfg.apPassword = "CharlieEcho123";
    cfg.deviceVersion = DEVICE_VERSION;
    cfg.WAKE_UP_WORD_ACCURACY = 0.65f;
    
    assistant = new ESP32HomeAssistant(cfg);
    assistant->begin();
}

void loop() {
}
