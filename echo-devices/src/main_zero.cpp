#include <ESP32HomeAssistant.h>

ESP32HomeAssistant* assistant = nullptr;

void setup() {
    Serial.begin(115200); 

    HAConfig cfg;
    cfg.apName = "CharlieEcho";    
    cfg.apPassword = "CharlieEcho123";
    
    assistant = new ESP32HomeAssistant(cfg);
    assistant->begin();
}

void loop() {
}
