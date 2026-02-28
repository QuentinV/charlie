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

#define BUFFER_SIZE 512

#define MIC_THRESHOLD_SOUND 500
#define MIC_DURATION_SILENCE 1

#define WAKE_UP_WORD_ACCURACY 0.5f

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
    uint8_t buf_ready;
    uint32_t buf_count;
    uint32_t n_samples;
    SemaphoreHandle_t mutex;
} inference_t;

static int16_t inference_window[16000];

inference_t inference;
const uint32_t sample_buffer_size = 2048;
signed short sampleBuffer[sample_buffer_size];

int32_t capture_raw32[2048];
int16_t capture_pcm16[2048];
size_t capture_bytes_read;
esp_err_t capture_err;

int32_t send_samples32[BUFFER_SIZE];
int16_t send_samples16[BUFFER_SIZE];
esp_err_t send_err;

bool continuous_record = true;

// Task handles
TaskHandle_t wakeUpWordHandle;
TaskHandle_t taskWebSocketHandle;
TaskHandle_t memoryPrintHandle;

bool debug_nn = false; // Set this to true to see e.g. features generated from the raw signal

bool detectDoubleReset() {
  prefs.begin("drd", false);

  unsigned long now = time(NULL);
  unsigned long last = prefs.getUInt("last", 0);

  Serial.println(now);
  Serial.println(last);


  prefs.putUInt("last", now);
  prefs.end();

  if (last == 0) return false;

  return (now - last) < DRD_TIMEOUT;
}

void runOTA() {
    pixels.setPixelColor(0, pixels.Color(255, 0, 255));
    pixels.show();

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
      .dma_buf_count = 8,
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

    inference.buffer = (int16_t *)malloc(n_samples * sizeof(int16_t));
    if (inference.buffer == NULL) {
        return false;
    }

    inference.buf_count = 0;
    inference.n_samples = n_samples;
    inference.buf_ready = 0;

    // Create mutex
    inference.mutex = xSemaphoreCreateMutex();
    if (inference.mutex == NULL) {
        free(inference.buffer);
        return false;
    }

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

void captureMicSamplesTask(void *arg) {
    const size_t chunk_bytes   = (size_t)arg;
    const size_t chunk_samples = chunk_bytes / sizeof(int16_t);

    //memset(capture_raw32, 0, sizeof(capture_raw32));
    //memset(capture_pcm16, 0, sizeof(capture_pcm16));
    capture_bytes_read = 0;

    while (true) {
          if (mute || !continuous_record) {
            vTaskDelay(1000 / portTICK_PERIOD_MS);
            continue;
        }

        capture_err = i2s_read(
            I2S_MIC_PORT,
            capture_raw32,
            chunk_samples * sizeof(int32_t),
            &capture_bytes_read,
            portMAX_DELAY
        );

        if (capture_err != ESP_OK || capture_bytes_read == 0) continue;

        size_t frames_read = capture_bytes_read / sizeof(int32_t);

        // Convert 32‑bit I2S to 16‑bit PCM
        for (size_t i = 0; i < frames_read; i++) {
            capture_pcm16[i] = (int16_t)(capture_raw32[i] >> 15);
        }

        // Write into circular buffer
        xSemaphoreTake(inference.mutex, portMAX_DELAY);

        for (size_t i = 0; i < frames_read; i++) {
            inference.buffer[inference.buf_count++] = capture_pcm16[i];

            if (inference.buf_count >= inference.n_samples) {
                inference.buf_count = 0;
                inference.buf_ready = 1;
            }
        }

        xSemaphoreGive(inference.mutex);
    }
}

void sendWakeWordWindow() {
    if (webSocket.isConnected())
        webSocket.sendTXT("WAKEWORD_START");

    // inference_window contains 16000 samples (1 sec @ 16 kHz)
    if (webSocket.isConnected())
        webSocket.sendBIN(
            (uint8_t*)inference_window,
            inference.n_samples * sizeof(int16_t)
        );

    if (webSocket.isConnected())
        webSocket.sendTXT("WAKEWORD_END");
}

void sendMicAudio() {
    size_t bytes_read = 0;
    silenceStart = 0;
    time_t startTime = time(NULL);

    //memset(send_samples32, 0, sizeof(send_samples32));
    //memset(send_samples16, 0, sizeof(send_samples16));

    pixels.setPixelColor(0, pixels.Color(255, 255, 255));
    pixels.show();

    for (;;) {
        time_t t = time(NULL);

        if (t - startTime > 20) {
            if (webSocket.isConnected())
                webSocket.sendTXT("END");
            break;
        }

        send_err = i2s_read(
            I2S_MIC_PORT,
            send_samples32,
            sizeof(send_samples32),
            &bytes_read,
            portMAX_DELAY
        );

        if (send_err != ESP_OK || bytes_read == 0) {
            continue;
        }

        size_t frames_read = bytes_read / sizeof(int32_t);
        
        for (size_t i = 0; i < frames_read; i++) {
            send_samples16[i] = (int16_t)(send_samples32[i] >> 15);
        }

        int32_t sum = 0;
        for (size_t i = 0; i < frames_read; i++) {
            sum += send_samples16[i];
        }
        int16_t mean = sum / frames_read;

        for (size_t i = 0; i < frames_read; i++) {
            send_samples16[i] -= mean;
        }

        for (size_t i = 0; i < frames_read; i++) {
            send_samples16[i] = send_samples16[i] * 8;
        }

        // ===== RMS calculation =====
        int64_t sumsq = 0;
        for (size_t i = 0; i < frames_read; i++) {
            int32_t s = send_samples16[i];
            sumsq += (int64_t)s * s;
        }

        int rms = sqrt((double)sumsq / frames_read);
        //Serial.printf("RMS %d \n", rms);

        // ===== Silence detection =====
        if (rms < MIC_THRESHOLD_SOUND) {
            if (silenceStart == 0) {
                silenceStart = t;
            } else if (t - silenceStart > MIC_DURATION_SILENCE) {
                //if (webSocket.isConnected())
                //    webSocket.sendTXT("END");
                break;
            }
        } else {
            silenceStart = 0;
        }

        if (webSocket.isConnected())
            webSocket.sendBIN((uint8_t*)send_samples16, frames_read * sizeof(int16_t));
    }

    sendWakeWordWindow();

    continuous_record = true;

    pixels.setPixelColor(0, pixels.Color(0, 0, 0));
    pixels.show();

    if (webSocket.isConnected())
        webSocket.sendTXT("start-mic-capture");
}

void memoryPrintTask(void *pvParameters) {
  vTaskDelay(5000 / portTICK_PERIOD_MS);
  for (;;) {
    Serial.printf("Free heap: %d bytes\n", esp_get_free_heap_size());
    Serial.printf("Largest free block: %d bytes\n", heap_caps_get_largest_free_block(MALLOC_CAP_DEFAULT));
    Serial.printf("Free internal RAM: %d bytes\n", heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
    Serial.printf("Free PSRAM: %d bytes\n", heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
    Serial.printf("memoryPrintTask - high water mark: %d words\n", uxTaskGetStackHighWaterMark(NULL));
    vTaskDelay(10000 / portTICK_PERIOD_MS);
  }
}

void onWakeWordDetected() {
  continuous_record = false;
  inference.buf_ready = 0;
  sendMicAudio();
}

int ei_get_sliding_window_data(size_t offset, size_t length, float *out_ptr) {
    for (size_t i = 0; i < length; i++) {
        out_ptr[i] = (float)inference_window[offset + i];
    }
    return 0;
}

void wakeUpWordTask(void *arg) {
    pixels.setPixelColor(0, pixels.Color(0, 0, 0));
    pixels.show();

    xTaskCreate(captureMicSamplesTask, "CaptureMicSamples", 8192, (void*)sample_buffer_size, 10, NULL);

    const size_t window = inference.n_samples;   // 16000
    const size_t hop    = 3200;                  // 200 ms @ 16 kHz
  
    while (true) {
        if (mute || !continuous_record) {
            vTaskDelay(1000 / portTICK_PERIOD_MS);
            continue;
        }

        if (inference.buf_ready) {       
            xSemaphoreTake(inference.mutex, portMAX_DELAY);

            // Compute start index for sliding window
            size_t start = (inference.buf_count + window - hop) % window;

            // Copy 1‑second window into inference_window[]
            for (size_t i = 0; i < window; i++) {
                size_t idx = (start + i) % window;
                inference_window[i] = inference.buffer[idx];
            }

            xSemaphoreGive(inference.mutex);

            // Apply gain
            float gain = 4.0f;
            for (size_t i = 0; i < window; i++) {
                inference_window[i] = (int16_t)((float)inference_window[i] * gain);
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

            if ( result.classification[0].value > WAKE_UP_WORD_ACCURACY) {
                onWakeWordDetected();
            }
        }

        vTaskDelay(pdMS_TO_TICKS(200)); // classify 5× per second
    }
}

void wsTask(void *arg) {
    webSocket.begin(serverip, WS_PORT, "/ws/echo");
    webSocket.onEvent(onWebSocketEvent);
    webSocket.setReconnectInterval(3000);
    webSocket.enableHeartbeat(120000, 30000, 2);

    while (true) {
        webSocket.loop();
        vTaskDelay(5 / portTICK_PERIOD_MS);
    }
}

void setup() {
  Serial.begin(115200); 

  if (detectDoubleReset()) {
    reset();
    return;
  }

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

  xTaskCreate( wakeUpWordTask, "WakeUpWord", 1024 * 16, NULL, 1, &wakeUpWordHandle );
  //xTaskCreate( memoryPrintTask, "MemoryPrint", 2000, NULL, 1, &memoryPrintHandle );
}

void loop() {
}
