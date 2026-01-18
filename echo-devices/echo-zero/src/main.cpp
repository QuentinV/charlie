#include <Arduino.h>
#include "esp_system.h"
#include "esp_heap_caps.h"
#include <WiFiManager.h>
#include <WiFiUdp.h>
#include <WiFi.h>
#include <Preferences.h>
#include <Adafruit_GFX.h>
#include <Adafruit_NeoPixel.h>
#include "driver/i2s.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define DRD_TIMEOUT 3

#define EIDSP_QUANTIZE_FILTERBANK   0
#include <charlie_inferencing.h>

#define WIFI_NAME "Charlie-Echo-Zero"
#define WIFI_PASS "CharlieEchoZero123"

#define AUDIO_UDP_PORT 9303
#define AUDIO_TCP_PORT 12345

#define I2S_MIC_PORT I2S_NUM_0
#define I2S_MIC_WS  GPIO_NUM_16
#define I2S_MIC_SD  GPIO_NUM_18
#define I2S_MIC_SCK GPIO_NUM_17
#define MIC_GAIN 3

#define I2S_SPK_PORT I2S_NUM_1
#define I2S_SPK_LRC GPIO_NUM_7
#define I2S_SPK_BCLK GPIO_NUM_6
#define I2S_SPK_DIN GPIO_NUM_5

#define BUFFER_SIZE 512

#define MIC_THRESHOLD_SOUND 10000
#define MIC_DURATION_SILENCE 2

#define WAKE_UP_WORD_ACCURACY 0.7f

 // Fixed‑point HPF coefficients (scaled by 256)
#define HP_A0  256
#define HP_A1 -512
#define HP_A2  256
#define HP_B1 -495
#define HP_B2  240

#define GATE_THRESHOLD 400 
#define GATE_SOFT 50

// preferences
Preferences prefs;
WiFiManager wm;
String serverip;

// Objects
Adafruit_NeoPixel pixels(1, GPIO_NUM_48, NEO_GRB + NEO_KHZ800);
WiFiServer server(AUDIO_TCP_PORT);
WiFiClient espClient;

// States
unsigned long silenceStart = 0;
bool mute = false;
bool speaker = false;

/** Audio buffers, pointers and selectors */
typedef struct {
    int16_t *buffer;
    uint8_t buf_ready;
    uint32_t buf_count;
    uint32_t n_samples;
} inference_t;

inference_t inference;
const uint32_t sample_buffer_size = 2048;
signed short sampleBuffer[sample_buffer_size];
bool debug_nn = false; // Set this to true to see e.g. features generated from the raw signal
bool continuous_record = true;

// Task handles
TaskHandle_t receivePlayAudioHandle;
TaskHandle_t wakeUpWordHandle;

bool test = true;

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

void setupWiFi() {
  prefs.begin("config", false);
  serverip = prefs.getString("serverIp", "");
  //Serial.println("Loaded serverIp: " + serverip);

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

int setupMicI2S(uint32_t sampling_rate) {
  // Start listening for audio: MONO @ 8/16KHz
  i2s_config_t i2s_config = {
      .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
      .sample_rate = 16000,
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
      .data_out_num = -1,
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

  ret = i2s_zero_dma_buffer(I2S_MIC_PORT);
  if (ret != ESP_OK) {
    ei_printf("Error in initializing dma buffer with 0");
  }

  ei_printf("Microphone configured");

  return int(ret);
}

void audio_inference_callback(uint32_t n_bytes) {
    for(int i = 0; i < n_bytes>>1; i++) {
        inference.buffer[inference.buf_count++] = sampleBuffer[i];

        if(inference.buf_count >= inference.n_samples) {
          inference.buf_count = 0;
          inference.buf_ready = 1;
        }
    }
}

bool allocateInferenceBuffer(uint32_t n_samples) {
  ei_sleep(100);

  inference.buffer = (int16_t *)malloc(n_samples * sizeof(int16_t));

  if(inference.buffer == NULL) {
      return false;
  }

  inference.buf_count  = 0;
  inference.n_samples  = n_samples;
  inference.buf_ready  = 0;

  return true;
}

bool microphone_inference_record(void) {
  bool ret = true;
  while (inference.buf_ready == 0) {
      delay(10);
  }
  inference.buf_ready = 0;
  return ret;
}

int microphone_audio_signal_get_data(size_t offset, size_t length, float *out_ptr) {
    numpy::int16_to_float(&inference.buffer[offset], out_ptr, length);
    return 0;
}

void setupSpeakerI2S() {
  const i2s_config_t spk_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
    .sample_rate = 22050,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_I2S_MSB,
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

void captureMicSamplesTask(void* arg) {
    continuous_record = true;

    const int32_t bytes_to_read = (uint32_t)arg;
    const int32_t samples_to_read = bytes_to_read / sizeof(int32_t);

    int32_t rawBuffer[2048];
    size_t bytes_read = 0;

    // Filter state
    int32_t hp_x1 = 0, hp_x2 = 0;
    int32_t hp_y1 = 0, hp_y2 = 0;
    int32_t prev_pre = 0;

    //const int32_t GATE_THRESHOLD = 300;
    //const int32_t GATE_SOFT = 40;

    while (continuous_record && !mute) {

        esp_err_t err = i2s_read(
            I2S_MIC_PORT,
            rawBuffer,
            bytes_to_read,
            &bytes_read,
            portMAX_DELAY
        );

        if (err != ESP_OK || bytes_read != bytes_to_read) {
            continue;
        }

        for (int i = 0; i < samples_to_read; i++) {
            // 24‑bit → 16‑bit
            int32_t x = rawBuffer[i] >> 8;

            // Pre‑emphasis
            int32_t pre = x - (prev_pre * 95 / 100);
            prev_pre = x;

            // 2‑pole high‑pass filter
            int32_t y = (HP_A0 * pre + HP_A1 * hp_x1 + HP_A2 * hp_x2
                        - HP_B1 * hp_y1 - HP_B2 * hp_y2) >> 8;

            hp_x2 = hp_x1;
            hp_x1 = pre;
            hp_y2 = hp_y1;
            hp_y1 = y;

            // Soft noise gate
            int32_t abs_y = (y < 0 ? -y : y);
            if (abs_y < GATE_THRESHOLD) {
                y = (y * GATE_SOFT) / GATE_THRESHOLD;
            }

            // Gain + clip
            int64_t temp = (int64_t)y * MIC_GAIN;
            if (temp > 32767) temp = 32767;
            if (temp < -32768) temp = -32768;

            sampleBuffer[i] = (int16_t)temp;
        }

        if (!continuous_record || mute) break;

        audio_inference_callback(samples_to_read * sizeof(int16_t));
    }

    vTaskDelete(NULL);
}

void startMicCaptureSamples() {
  pixels.setPixelColor(0, pixels.Color(0, 0, 0));
  pixels.show();
  xTaskCreate(captureMicSamplesTask, "CaptureMicSamples", 1024 * 32, (void*)sample_buffer_size, 10, NULL);
}

void sendMicAudioTask(void *arg) {
  //Serial.println("sendMicAudioTask - start");

  int32_t samples32[BUFFER_SIZE];
  int16_t samples16[BUFFER_SIZE];

  int32_t hp_x1 = 0, hp_x2 = 0; 
  int32_t hp_y1 = 0, hp_y2 = 0;
  int32_t prev_sample = 0;

  size_t bytes_read = 0;
  silenceStart = 0;
  time_t startTime = time(NULL);

  for (;;) {
    time_t t = time(NULL);

    if (t - startTime > 20) {
      //Serial.println("sendMicAudioTask - timeout reached");
      WiFiUDP udp;
      udp.beginPacket(serverip.c_str(), AUDIO_UDP_PORT);
      udp.print("END");
      udp.endPacket();
      break;
    }

    i2s_read(I2S_MIC_PORT, samples32, sizeof(samples32), &bytes_read, portMAX_DELAY);
    
    size_t samples_read = bytes_read / sizeof(int32_t);

    for (int i = 0; i < samples_read; i++) {
        // ===== 24‑bit → 16‑bit =====
        int32_t x = samples32[i] >> 8;

        // ===== Pre‑emphasis =====
        int32_t pre = x - (prev_sample * 95 / 100);
        prev_sample = x;

        // ===== 2‑pole high‑pass filter (fixed‑point) =====
        int32_t y = (HP_A0 * pre + HP_A1 * hp_x1 + HP_A2 * hp_x2
                    - HP_B1 * hp_y1 - HP_B2 * hp_y2) >> 8;

        hp_x2 = hp_x1;
        hp_x1 = pre;
        hp_y2 = hp_y1;
        hp_y1 = y;

        // ===== Soft noise gate =====
        int32_t abs_y = (y < 0 ? -y : y);

        if (abs_y < GATE_THRESHOLD) {
            y = (y * GATE_SOFT) / GATE_THRESHOLD;
        }

        samples16[i] = (int16_t)y;
    }

    // RMS calculation
    int64_t sumsq = 0;
    for (size_t i = 0; i < samples_read; i++) {
        int32_t s = samples16[i];
        sumsq += (int64_t)s * s;
    }
    int rms = sqrt((double)sumsq / samples_read);

    //Serial.println(rms);

    if (rms < MIC_THRESHOLD_SOUND) {   
      if (silenceStart == 0 ) {
        //Serial.println("sendMicAudioTask - its quiete");
        silenceStart = t;
      } else if (t - silenceStart > MIC_DURATION_SILENCE ) {
        //Serial.println("sendMicAudioTask - it has been 2 seen quite send END");
        WiFiUDP udp;
        udp.beginPacket(serverip.c_str(), AUDIO_UDP_PORT);
        udp.print("END");
        udp.endPacket();
        
        break;
      }
    } else {
      silenceStart = 0;
    }

    //Serial.println("sendMicAudioTask - end");
    //Serial.println(serverip.c_str());
    //Serial.printf("Read %d bytes (%d samples), RMS=%d\n", bytes_read, samples_read, rms);
    WiFiUDP udp;
    udp.beginPacket(serverip.c_str(), AUDIO_UDP_PORT);
    udp.write((uint8_t*)samples16, samples_read * sizeof(int16_t));
    udp.endPacket();
  }

  startMicCaptureSamples();
  
  vTaskDelete(NULL);
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

void receiveAndPlayAudioTask(void *arg) {
  server.begin();

  for (;;) {
    WiFiClient client = server.available();
    if (!client) {
      vTaskDelay(1000 / portTICK_PERIOD_MS);
      continue;
    }
    
    speaker = true;
    uint8_t buffer[BUFFER_SIZE];
    while (client.connected() && speaker) {
      int len = client.read(buffer, sizeof(buffer));
          
      if (len > 0) {
        size_t bytes_written;
        i2s_write(I2S_SPK_PORT, buffer, len, &bytes_written, portMAX_DELAY);
      }
    }

    client.stop();
  } 
}

void startMicUserRecord() {
  xTaskCreate(sendMicAudioTask, "SendMicAudioTask", 1024 * 8, NULL, 10, NULL);
}

void onWakeWordDetected() {
  pixels.setPixelColor(0, pixels.Color(255, 255, 255));
  pixels.show();
  continuous_record = false;
  startMicUserRecord();
}

void wakeUpWordTask(void *arg) {
  startMicCaptureSamples();
  for (;;) {
    if (mute || !continuous_record) {
        vTaskDelay(1000 / portTICK_PERIOD_MS);
        continue;
    }
    bool m = microphone_inference_record();
    if (!m) {
        ei_printf("ERR: Failed to record audio...\n");
        return;
    }

    signal_t signal;
    signal.total_length = EI_CLASSIFIER_RAW_SAMPLE_COUNT;
    signal.get_data = &microphone_audio_signal_get_data;
    ei_impulse_result_t result = { 0 };

    EI_IMPULSE_ERROR r = run_classifier(&signal, &result, debug_nn);
    if (r != EI_IMPULSE_OK) {
        ei_printf("ERR: Failed to run classifier (%d)\n", r);
        return;
    }
    
    if ( result.classification[0].value > WAKE_UP_WORD_ACCURACY) {
        onWakeWordDetected();
    /*} else if (result.classification[1].value > 0.8f || result.classification[3].value > 0.8f) {
        speaker = false;
        ei_printf("Merci OR stop\n");*/
    } /*else {
      // print the predictions
      ei_printf("Predictions ");
      ei_printf("(DSP: %d ms., Classification: %d ms., Anomaly: %d ms.)",
          result.timing.dsp, result.timing.classification, result.timing.anomaly);
      ei_printf(": \n");
      for (size_t ix = 0; ix < EI_CLASSIFIER_LABEL_COUNT; ix++) {
          ei_printf("    %s: ", result.classification[ix].label);
          ei_printf_float(result.classification[ix].value);
          ei_printf("\n");
      }
    }*/

    //Serial.printf("WakeUpWordTask - high water mark: %d words\n", uxTaskGetStackHighWaterMark(NULL));
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
  
  xTaskCreate( receiveAndPlayAudioTask, "ReceivePlayAudio", 1024 * 8, NULL, 1, &receivePlayAudioHandle );
  xTaskCreate( wakeUpWordTask, "WakeUpWord", 4096, NULL, 1, &wakeUpWordHandle );
}

void loop() {
}
