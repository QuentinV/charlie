#include <Arduino.h>
#include "esp_system.h"
#include "esp_heap_caps.h"
#include <WiFiManager.h>
#include <WiFi.h>
#include <Preferences.h>
#include <Adafruit_GFX.h>
#include <Adafruit_NeoPixel.h>
#include "driver/i2s.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <WebSocketsClient.h>
#include <Wire.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <Adafruit_SSD1306.h>

#define WS_PORT 9303

#define DRD_TIMEOUT 3
#define MIC_THRESHOLD_SOUND 500
#define MIC_DURATION_SILENCE 1
#define EIDSP_QUANTIZE_FILTERBANK   0

 // Fixed‑point HPF coefficients (scaled by 256)
#define HP_A0  256
#define HP_A1 -512
#define HP_A2  256
#define HP_B1 -495
#define HP_B2  240

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 32
#define OLED_RESET    -1

struct HAConfig {
    // WiFi / portal
    const char* apName     = "HomeAssistantEcho";
    const char* apPassword = "HomeAssistantEcho123";

    const char* deviceType = "echo-zero";
    float WAKE_UP_WORD_ACCURACY = 0.8f;
    String overwriteServerip;
    

    // NeoPixel
    uint8_t neoPixelPin    = GPIO_NUM_48;
    uint8_t neoPixelCount  = 1;
    uint8_t neoPixelBright = 50;

    i2s_port_t I2S_MIC_PORT = I2S_NUM_0;
    gpio_num_t I2S_MIC_WS = GPIO_NUM_17;
    gpio_num_t I2S_MIC_SD = GPIO_NUM_18;
    gpio_num_t I2S_MIC_SCK = GPIO_NUM_16;

    i2s_port_t I2S_SPK_PORT = I2S_NUM_1;
    gpio_num_t I2S_SPK_LRC = GPIO_NUM_7;
    gpio_num_t I2S_SPK_BCLK = GPIO_NUM_6;
    gpio_num_t I2S_SPK_DIN = GPIO_NUM_5;

    gpio_num_t OLED_SDA = GPIO_NUM_1;
    gpio_num_t OLED_SCL = GPIO_NUM_2;    

    bool screenEnabled = false;
};

typedef struct {
    int16_t *buffer;
    uint32_t buf_count;
    uint32_t n_samples;
} inference_t;

class ESP32HomeAssistant {
public:
    explicit ESP32HomeAssistant(const HAConfig& cfg);

    // Call once in setup()
    void begin();
    void setLed(uint8_t r, uint8_t g, uint8_t b);
    void reset();

    void printMemoryUsage();

    int _ei_get_sliding_window_data(size_t offset, size_t length, float *out_ptr);
    void _onWebSocketEvent(WStype_t type, uint8_t * payload, size_t length);
    void _listenAndSendTask(void *arg);
    void _wsTask(void *arg);
    void _displayStatusOnScreenTask(void *arg);

    static ESP32HomeAssistant* instance;
private:
    void _runOTA();
    void _setupWiFi();
    void _playAudio(uint8_t* data, size_t len);
    int _setupMicI2S(uint32_t sampling_rate);
    void _setupSpeakerI2S();

    bool _allocateInferenceBuffer(uint32_t n_samples);
    void _drawListeningScreen();
    void displayText(String msg);

    // State
    HAConfig            _cfg;
    Preferences         _prefs;
    WiFiManager         _wm;
    Adafruit_NeoPixel*  _pixels = nullptr;    
    Adafruit_SSD1306*   display;

    unsigned long silenceStart = 0;
    bool mute = false;
    bool isWsConnected = false;

    String serverip;
    WebSocketsClient webSocket;

    int16_t* inference_window = NULL;
    inference_t inference;

    // Task handles
    TaskHandle_t listenAndSendHandle;
    TaskHandle_t taskWebSocketHandle;
    TaskHandle_t screenHandle;
};
