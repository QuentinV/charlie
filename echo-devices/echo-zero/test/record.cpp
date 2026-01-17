#include <Arduino.h>
#include <WiFiManager.h>
#include <WiFiUdp.h>
#include <WiFi.h>
#include <Preferences.h>
#include <Wire.h>
#include "time.h"
#include "driver/i2s.h"

#define AUDIO_UDP_PORT 9303


#define I2S_MIC_PORT I2S_NUM_0
#define I2S_MIC_WS  GPIO_NUM_1
#define I2S_MIC_SD  GPIO_NUM_42
#define I2S_MIC_SCK GPIO_NUM_2

#define SAMPLE_RATE 16000
#define BUFFER_SIZE 512


const uint32_t sample_buffer_size = 2048;
signed short sampleBuffer[sample_buffer_size];

Preferences prefs;
String serverip;

bool sendMicAudio() {
  const int32_t i2s_bytes_to_read = (uint32_t)2048;
  size_t bytes_read = i2s_bytes_to_read;

  while (true) {
    /* read data at once from i2s */
    i2s_read(I2S_MIC_PORT, (void*)sampleBuffer, i2s_bytes_to_read, &bytes_read, 100);

    if (bytes_read <= 0) {
      continue;
    }

    // scale the data (otherwise the sound is too quiet)
    for (int x = 0; x < i2s_bytes_to_read/2; x++) {
        sampleBuffer[x] = (int16_t)(sampleBuffer[x]) * 8;
    }

    WiFiUDP udp;
    udp.beginPacket(serverip.c_str(), AUDIO_UDP_PORT);
    udp.write((uint8_t*)sampleBuffer, bytes_read);
    udp.endPacket();
  }
}

void setupMicI2S() {
  // Start listening for audio: MONO @ 8/16KHz
  i2s_config_t i2s_config = {
      .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
      .sample_rate = 16000,
      .bits_per_sample = (i2s_bits_per_sample_t)16,
      .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
      .communication_format = I2S_COMM_FORMAT_I2S,
      .intr_alloc_flags = 0,
      .dma_buf_count = 8,
      .dma_buf_len = 256,
      .use_apll = false,
      .tx_desc_auto_clear = false,
      .fixed_mclk = -1,
  };
  i2s_pin_config_t pin_config = {
      .bck_io_num = I2S_MIC_SCK,
      .ws_io_num = I2S_MIC_WS,
      .data_out_num = -1,
      .data_in_num = I2S_MIC_SD
  };

  i2s_driver_install(I2S_MIC_PORT, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_MIC_PORT, &pin_config);
  
  i2s_zero_dma_buffer(I2S_MIC_PORT);
}

void setup() {
  prefs.begin("config", false);
  serverip = "192.168.1.24";//prefs.getString("serverip", "192.168.1.24");
  prefs.end();

  WiFi.begin();

  if (WiFi.waitForConnectResult() != WL_CONNECTED) {
    return;
  }
  setupMicI2S();
}

void loop() {
  sendMicAudio();
}