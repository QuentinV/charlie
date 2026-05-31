#include <Arduino.h>
#include <ArduinoJson.h>
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
#include <vector>
#include <Adafruit_AHTX0.h>

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

#define MAX_SAMPLES 320000 // 20s max
#define MAX_SAMPLES_PLAYBACK 640000

struct I2CScreen {
    uint8_t w;
    uint8_t h;
    uint8_t r;   
    uint8_t channel; 
};

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

    // Mic
    i2s_port_t I2S_MIC_PORT = I2S_NUM_0;
    gpio_num_t I2S_MIC_WS = GPIO_NUM_17;
    gpio_num_t I2S_MIC_SD = GPIO_NUM_18;
    gpio_num_t I2S_MIC_SCK = GPIO_NUM_16;

    // Speaker
    i2s_port_t I2S_SPK_PORT = I2S_NUM_1;
    gpio_num_t I2S_SPK_LRC = GPIO_NUM_7;
    gpio_num_t I2S_SPK_BCLK = GPIO_NUM_6;
    gpio_num_t I2S_SPK_DIN = GPIO_NUM_5;

    // Screens
    std::vector<I2CScreen> displays;

    // Temp
    gpio_num_t TEMP_SDA = GPIO_NUM_41;
    gpio_num_t TEMP_SCL = GPIO_NUM_42;

    // Default screen
    gpio_num_t OLED_SDA = GPIO_NUM_17;
    gpio_num_t OLED_SCL = GPIO_NUM_18;    

    bool feedbackScreenEnabled = false;
    bool displayScreenTime = false;
    bool tempSensorEnabled = false;
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
    void displayFeedback(String msg);
    void reset();

    void printMemoryUsage();

    int _ei_get_sliding_window_data(size_t offset, size_t length, float *out_ptr);
    void _listenAndSendTask(void *arg);
    void _onWebSocketEvent(WStype_t type, uint8_t * payload, size_t length);
    void _wsTask(void *arg);
    void _displayStatusOnScreenTask(void *arg);
    
    static ESP32HomeAssistant* instance;
private:
    void _runOTA();
    void _setWakeUpWordAccuracy(float accuracy);
    void _setServerIp(String serverip);
    void _setupWiFi();
    void _tcaSelect(uint8_t channel); // multiplexer i2s
    void _setupDisplays();
    void _setupTempSensor();

    void _handleIncomingAudio(uint8_t *payload, size_t length);
    void _playBufferedAudio();
    void _setupSpeakerI2S();

    int _setupMicI2S(uint32_t sampling_rate);
    bool _allocateInferenceBuffer(uint32_t n_samples);    
    void _sendAudioWS();

    void _drawListeningScreen();
    void _updateDisplay(int key, JsonArray texts );

    // State
    HAConfig            _cfg;
    Preferences         _prefs;
    WiFiManager         _wm;
    Adafruit_NeoPixel*  _pixels = nullptr;    

    std::vector<Adafruit_SSD1306*> _displays;

    Adafruit_AHTX0 _tempSensor;

    unsigned long silenceStart = 0;
    bool mute = false;
    bool isWsConnected = false;

    String serverip;
    float wakeUpWordAccuracy;
    WebSocketsClient webSocket;

    int16_t* inference_window = NULL;
    inference_t inference;

    int16_t* bufferCaptureAudio = NULL;
    size_t totalRecordedSamples;

    int16_t* playbackBuffer = NULL;
    size_t totalPlaybackSamples;

    // Task handles
    TaskHandle_t listenAndSendHandle;
    TaskHandle_t taskWebSocketHandle;
    TaskHandle_t screenHandle;
};
