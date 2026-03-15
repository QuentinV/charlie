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

#define DRD_TIMEOUT 3

#define EIDSP_QUANTIZE_FILTERBANK   0
#include <charlie-2_inferencing.h>

#define ECHO_DEVICE_TYPE "echo-zero"
#define WIFI_NAME "Charlie-Echo-Zero"
#define WIFI_PASS "CharlieEchoZero123"

#define WS_PORT 9303

#define I2S_MIC_PORT I2S_NUM_0
#define I2S_MIC_WS  GPIO_NUM_17
#define I2S_MIC_SD  GPIO_NUM_18
#define I2S_MIC_SCK GPIO_NUM_16

#define I2S_SPK_PORT I2S_NUM_1
#define I2S_SPK_LRC GPIO_NUM_7
#define I2S_SPK_BCLK GPIO_NUM_6
#define I2S_SPK_DIN GPIO_NUM_5

#define MIC_THRESHOLD_SOUND 500
#define MIC_DURATION_SILENCE 1

#define WAKE_UP_WORD_ACCURACY 0.8f

 // Fixed‑point HPF coefficients (scaled by 256)
#define HP_A0  256
#define HP_A1 -512
#define HP_A2  256
#define HP_B1 -495
#define HP_B2  240

// preferences
Preferences prefs;
WiFiManager wm;
String serverip;

// Objects
Adafruit_NeoPixel pixels(1, GPIO_NUM_48, NEO_GRB + NEO_KHZ800);

WebSocketsClient webSocket;

// States
unsigned long silenceStart = 0;
bool mute = false;
bool isWsConnected = false;

/** Audio buffers, pointers and selectors */
typedef struct {
    int16_t *buffer;
    uint32_t buf_count;
    uint32_t n_samples;
} inference_t;

static int16_t* inference_window = NULL;
static inference_t inference;

// Task handles
TaskHandle_t listenAndSendHandle;
TaskHandle_t taskWebSocketHandle;

void runOTA() {
    pixels.setPixelColor(0, pixels.Color(255, 0, 255));
    pixels.show();
    vTaskDelete(taskWebSocketHandle);
    vTaskDelete(listenAndSendHandle);

    serverip = "192.168.1.17";
    WiFiClient client;
    t_httpUpdate_return ret = httpUpdate.update( client, "http://" + serverip + ":9300/api/echo/" + ECHO_DEVICE_TYPE + "/latest/firmware.bin" );

    switch (ret) {
        case HTTP_UPDATE_FAILED:
            pixels.setPixelColor(0, pixels.Color(255, 0, 0));
            pixels.show();
            webSocket.sendTXT(("OTA_FAILED: ") + httpUpdate.getLastErrorString());
            break;

        case HTTP_UPDATE_NO_UPDATES:
            pixels.setPixelColor(0, pixels.Color(0, 0, 0));
            pixels.show();
            webSocket.sendTXT("No update available");
            break;

        case HTTP_UPDATE_OK:
            pixels.setPixelColor(0, pixels.Color(0, 0, 255));
            pixels.show();
            webSocket.sendTXT("Update OK, rebooting...");
            break;
    }
    
    delay(3000);
    ESP.restart();
}

void setupWiFi() {
  prefs.begin("config", false);
  serverip = prefs.getString("serverIp", "");
  Serial.println("Loaded serverIp: " + serverip);

  WiFi.mode(WIFI_AP_STA);

  wm.setConfigPortalBlocking(true);
  wm.setDebugOutput(true);

  WiFiManagerParameter customServiceIp("serverIp", "Charlie server IP", serverip.c_str(), 16);
  wm.addParameter(&customServiceIp);

  bool res = wm.autoConnect(WIFI_NAME, WIFI_PASS);

  if (!res) {
    delay(3000);
    ESP.restart();
  }

  String serverIp = customServiceIp.getValue();
  if (serverIp.length() == 0) {
    wm.startConfigPortal(WIFI_NAME, WIFI_PASS);
  }

  prefs.putString("serverIp", serverIp);
  serverip = serverIp;

  prefs.end();
}

void reset() {
  Serial.println("Reset......");
  wm.resetSettings();
  prefs.begin("config", false);
  prefs.clear();
  prefs.end();
  delay(4000);
  ESP.restart();
}

void playAudio(uint8_t* data, size_t len) {
    int16_t* samples = (int16_t*)data;
    size_t sample_count = len / 2;

    float volume = 0.5f;  // clean, safe, non-distorting

    for (size_t i = 0; i < sample_count; i++) {
        float s = samples[i] * volume;

        // clamp
        if (s > 32767) s = 32767;
        if (s < -32768) s = -32768;

        samples[i] = (int16_t)s;
    }

    size_t bytes_written;
    i2s_write(I2S_SPK_PORT, data, len, &bytes_written, portMAX_DELAY);
}

void onWebSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
        isWsConnected = false;
        break;
    case WStype_CONNECTED:
        isWsConnected = true;
        break;
    case WStype_TEXT:
        {
            String msg = String((char*)payload);
            if (msg == "OTA") {
                runOTA();
            }
            break;    
        }
    case WStype_BIN:
        playAudio(payload, length);
        break;
  }
}

int setupMicI2S(uint32_t sampling_rate) {
  // Start listening for audio: MONO @ 8/16KHz
  i2s_config_t i2s_config = {
      .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
      .sample_rate = sampling_rate,
      .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
      .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
      .communication_format = I2S_COMM_FORMAT_STAND_I2S,
      .intr_alloc_flags = 0,
      .dma_buf_count = 80,
      .dma_buf_len = 512,
      .use_apll = false,
      .tx_desc_auto_clear = false,
      .fixed_mclk = -1
  };

  i2s_pin_config_t pin_config = {
      .bck_io_num = I2S_MIC_SCK,
      .ws_io_num = I2S_MIC_WS,
      .data_out_num = I2S_PIN_NO_CHANGE,
      .data_in_num = I2S_MIC_SD
  };
  esp_err_t ret = 0;

  ret = i2s_driver_install(I2S_MIC_PORT, &i2s_config, 0, NULL);
  if (ret != ESP_OK) {
    ei_printf("Error in i2s_driver_install");
  }

  ret = i2s_set_pin(I2S_MIC_PORT, &pin_config);
  if (ret != ESP_OK) {
    ei_printf("Error in i2s_set_pin");
  }

  
  ret = i2s_set_clk(I2S_MIC_PORT, sampling_rate, I2S_BITS_PER_SAMPLE_32BIT, I2S_CHANNEL_MONO);
  if (ret != ESP_OK) {
    ei_printf("Error in i2s_set_clk");
  }

  ret = i2s_zero_dma_buffer(I2S_MIC_PORT);
  if (ret != ESP_OK) {
    ei_printf("Error in initializing dma buffer with 0");
  }

  ei_printf("Microphone configured");

  return int(ret);
}

bool allocateInferenceBuffer(uint32_t n_samples) {
    ei_sleep(100);

    inference.buffer = (int16_t*)heap_caps_malloc(16000 * sizeof(int16_t), MALLOC_CAP_SPIRAM);
    inference_window = (int16_t*)heap_caps_malloc(16000 * sizeof(int16_t), MALLOC_CAP_SPIRAM);

    if (inference.buffer == NULL || inference_window == NULL) {
        Serial.println("PSRAM Allocation Failed!");
    } else {
        Serial.printf("Buffer moved to PSRAM. New Address: %p\n", (void*)inference_window);
    }

    if (inference.buffer == NULL) {
        return false;
    }

    inference.buf_count = 0;
    inference.n_samples = n_samples;

    return true;
}

void setupSpeakerI2S() {
  const i2s_config_t spk_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
    .sample_rate = 22050,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_MSB,
    .intr_alloc_flags = 0,
    .dma_buf_count = 8,
    .dma_buf_len = 64,
    .use_apll = false,
    .tx_desc_auto_clear = true
  };

  i2s_pin_config_t spk_pins = {
    .bck_io_num = I2S_SPK_BCLK,
    .ws_io_num = I2S_SPK_LRC,
    .data_out_num = I2S_SPK_DIN,
    .data_in_num = I2S_PIN_NO_CHANGE
  };

  i2s_driver_install(I2S_SPK_PORT, &spk_config, 0, NULL);
  i2s_set_pin(I2S_SPK_PORT, &spk_pins);
}

int ei_get_sliding_window_data(size_t offset, size_t length, float *out_ptr) {
    for (size_t i = 0; i < length; i++) {
        out_ptr[i] = (float)inference_window[offset + i];
    }
    return 0;
}

void printMemoryUsage() {
    Serial.println("--- Memory Report ---");
    
    // This is critical for DMA and Task Stacks
    size_t freeInternal = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
    size_t minFreeInternal = heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL);
    
    Serial.printf("Internal Free: %d bytes\n", freeInternal);
    Serial.printf("Internal Min Ever Free (High Water Mark): %d bytes\n", minFreeInternal);

    // PSRAM
    if (psramFound()) {
        size_t freePSRAM = heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
        Serial.printf("PSRAM Free: %d bytes\n", freePSRAM);
    } else {
        Serial.println("PSRAM not detected!");
    }

    // Tells you how close the current task is to a Stack Overflow
    Serial.printf("Current Task Stack Remaining: %d bytes\n", uxTaskGetStackHighWaterMark(NULL));
    Serial.println("----------------------");

    Serial.printf("Buffer Address: %p\n", (void*)inference_window);
    
    Serial.println("----------------------");
}

void listenAndSendTask(void *arg) {
    pixels.setPixelColor(0, pixels.Color(0, 0, 0));
    pixels.show();

    const size_t window = inference.n_samples;   // 16000
    const size_t hop    = 3200;                  // 200 ms @ 16 kHz
    float gain = 4.0f;

    const size_t chunk_samples = 512; 
    int32_t capture_raw32[chunk_samples];
    int16_t capture_pcm16[chunk_samples];

    esp_err_t capture_err;
    size_t capture_bytes_read;

    size_t samples_since_last_inference = 0;
    silenceStart = 0;
    time_t startTime = 0;
    bool sendMode = false;

    while (true) {
        vTaskDelay(pdMS_TO_TICKS(2));

        capture_err = i2s_read(
            I2S_MIC_PORT,
            capture_raw32,
            sizeof(capture_raw32),
            &capture_bytes_read,
            portMAX_DELAY
        );

        if (capture_err != ESP_OK || capture_bytes_read == 0) {
            continue;
        }

        size_t frames_read = capture_bytes_read / sizeof(int32_t);

        int64_t sum = 0;
        // Convert 32‑bit I2S to 16‑bit PCM
        for (size_t i = 0; i < frames_read; i++) {
            capture_pcm16[i] = (int16_t)(capture_raw32[i] >> 15);
            capture_pcm16[i] = (int16_t)((float)capture_pcm16[i] * gain);
            sum += capture_pcm16[i];

             // Push to circular buffer (inference.buffer should be size 16000)
            inference.buffer[inference.buf_count] = capture_pcm16[i];
            inference.buf_count = (inference.buf_count + 1) % window;
        }

        if (sendMode) {
            time_t t = time(NULL);

            if (t - startTime > 2) {
                Serial.println("Max duration reached. Ending.");

                if (webSocket.isConnected())
                    webSocket.sendTXT("end");

                sendMode = false;
                pixels.setPixelColor(0, pixels.Color(0, 0, 0));
                pixels.show();
                continue;
            }

            // ===== RMS calculation =====
            int64_t sumsq = 0;
            for (size_t i = 0; i < frames_read; i++) {
                int32_t s = capture_pcm16[i];
                sumsq += (int64_t)s * s;
            }

            int rms = sqrt((double)sumsq / frames_read);

            // ===== Silence detection =====
            if (rms < MIC_THRESHOLD_SOUND) {
                if (silenceStart == 0) {
                    silenceStart = t;
                } else if (t - silenceStart > MIC_DURATION_SILENCE) {
                    if (webSocket.isConnected())
                        webSocket.sendTXT("end");
                    sendMode = false;
                    pixels.setPixelColor(0, pixels.Color(0, 0, 0));
                    pixels.show();
                    continue;
                }
            } else {
                silenceStart = 0;
            }

            if (webSocket.isConnected())
                webSocket.sendBIN((uint8_t*)capture_pcm16, frames_read * sizeof(int16_t));

        } else {
            samples_since_last_inference += frames_read;

            // Only run AI every 'hop' (200ms), but use the full 1s 'window'
            if (samples_since_last_inference >= hop) {
                samples_since_last_inference = 0;
                
                // Flatten circular buffer into a linear window for Edge Impulse
                for (size_t i = 0; i < window; i++) {
                    // Start reading from the oldest sample in the circular buffer
                    inference_window[i] = inference.buffer[(inference.buf_count + i) % window];
                }

                // DC removal
                int64_t sum = 0;
                for (size_t i = 0; i < window; i++) sum += inference_window[i];
                int32_t mean = sum / window;
                for (size_t i = 0; i < window; i++) inference_window[i] -= mean;

                // Build EI signal
                signal_t signal;
                signal.total_length = window;
                signal.get_data = &ei_get_sliding_window_data;

                ei_impulse_result_t result;
                run_classifier(&signal, &result, false);

                //Serial.printf("Classification = %f", result.classification[0].value);
                if ( result.classification[0].value > WAKE_UP_WORD_ACCURACY) {
                    pixels.setPixelColor(0, pixels.Color(255, 255, 255));
                    pixels.show();

                    sendMode = true;
                    silenceStart = 0;

                    if (webSocket.isConnected()) {
                        webSocket.sendTXT("start");
                        webSocket.sendBIN( (uint8_t*)inference_window, window * sizeof(int16_t) );
                    }
                    
                    startTime = time(NULL);
                }
            }
        }    
    }
}

void wsTask(void *arg) {
    webSocket.begin(serverip, WS_PORT, "/ws/echo");
    webSocket.onEvent(onWebSocketEvent);
    webSocket.setReconnectInterval(3000);
    webSocket.enableHeartbeat(120000, 30000, 2);

    while (true) {
        webSocket.loop();
        vTaskDelay(20 / portTICK_PERIOD_MS);
    }
}

void setup() {
  Serial.begin(115200); 

  pixels.begin();
  pixels.setBrightness(50);

  pixels.setPixelColor(0, pixels.Color(0, 255, 0));
  pixels.show();

  setupWiFi();

  Serial.println("WIFI configured");
  Serial.printf("Current IP: %s\n", WiFi.localIP().toString().c_str());

  if (allocateInferenceBuffer(EI_CLASSIFIER_RAW_SAMPLE_COUNT) == false) {
      ei_printf("ERR: Could not allocate audio buffer (size %d), this could be due to the window length of your model\r\n", EI_CLASSIFIER_RAW_SAMPLE_COUNT);
      return;
  }  

  setupSpeakerI2S();
  if (setupMicI2S(EI_CLASSIFIER_FREQUENCY)) {
      ei_printf("Failed to start I2S!");
  }
  
  setenv("TZ", "CETCEST,M3.5.0,M10.5.0/3", 1);
  tzset();

  configTime(3600, 0, "pool.ntp.org", "time.nist.gov", "time.google.com");

  pixels.setPixelColor(0, pixels.Color(0, 0, 255));
  pixels.show();
  
  xTaskCreatePinnedToCore(wsTask, "TaskWebSocket", 4096, NULL, 1, &taskWebSocketHandle, 0);
  delay(10000);
  xTaskCreatePinnedToCore( listenAndSendTask, "ListenAndSend", 1024 * 16, NULL, 10, &listenAndSendHandle, 1 );
}

void loop() {
}
