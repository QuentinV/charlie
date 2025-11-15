#include <Arduino.h>
#include "esp_heap_caps.h"
#include <WiFiManager.h>
#include <WiFiUdp.h>
#include <WiFi.h>
#include <Preferences.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_Sensor.h>
#include <DHT.h>
#include "time.h"
#include "driver/i2s.h"
#include <math.h>

#define DEVICE_NAME "c-echo-1"
#define DATA_UDP_PORT 60555
#define AUDIO_UDP_PORT 12345
#define AUDIO_TCP_PORT 12345
#define SLEEP_TIME 60000000 // 1min

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
#define OLED_SDA      GPIO_NUM_21
#define OLED_SCL      GPIO_NUM_20

#define LED_PIN     GPIO_NUM_13
#define LED_COUNT   8 

#define DHTPIN GPIO_NUM_14
#define DHTTYPE DHT22

#define MOTION_PIN GPIO_NUM_1

#define TOUCH_PIN GPIO_NUM_13

#define I2S_MIC_PORT I2S_NUM_0
#define I2S_MIC_WS  GPIO_NUM_41
#define I2S_MIC_SD  GPIO_NUM_40
#define I2S_MIC_SCK GPIO_NUM_42

#define I2S_SPK_PORT I2S_NUM_1
#define I2S_SPK_LRC GPIO_NUM_18
#define I2S_SPK_BCLK GPIO_NUM_17
#define I2S_SPK_DIN GPIO_NUM_16

#define SAMPLE_RATE 8000
#define BUFFER_SIZE 512

Preferences prefs;
String serverip;

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
DHT dht(DHTPIN, DHTTYPE);

void displayText(String text) {
  display.clearDisplay();
  display.setCursor(0, 10);
  display.println(text);
  display.display();
}

void displayStatusOnScreen() {
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity(); 

  display.clearDisplay();

  // top left
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.printf("%.1fC", temp);

  // top right
  display.setCursor(SCREEN_WIDTH - 30, 0);
  display.printf("%.1f%%", hum);

  display.display();

  // Middle centered
  struct tm timeinfo;
  bool hasTime = !getLocalTime(&timeinfo);
  if ( hasTime ) {
    display.setTextSize(3);
    char timestr[16];
    strftime(timestr, sizeof(timestr), "%H:%M", &timeinfo);
    int16_t x, y;
    uint16_t w, h;
    display.getTextBounds(timestr, 0, 0, &x, &y, &w, &h);
    display.setCursor((SCREEN_WIDTH - w) / 2, (SCREEN_HEIGHT - h) / 2);
    display.print(timestr);
    display.display();
  }
}

void report() {
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity(); 

  WiFiUDP udp;
  udp.beginPacket(serverip.c_str(), DATA_UDP_PORT);
  udp.printf("%s:%.1f:%.1f", DEVICE_NAME, temp, hum);
  udp.endPacket();
}

void deepsleep() {
  display.clearDisplay();
  display.display();
  display.ssd1306_command(SSD1306_DISPLAYOFF);

  esp_sleep_enable_timer_wakeup(SLEEP_TIME);
  esp_deep_sleep_start();
}

void sendMicAudio() {  
  int32_t raw_samples[BUFFER_SIZE];
  size_t bytes_read = 0;
  i2s_read(I2S_NUM_0, raw_samples, sizeof(int32_t) * BUFFER_SIZE, &bytes_read, portMAX_DELAY);
  int samples_read = bytes_read / sizeof(int32_t);

  WiFiUDP udp;
  udp.beginPacket(serverip.c_str(), AUDIO_UDP_PORT);
  udp.write((uint8_t*)raw_samples, bytes_read);
  udp.endPacket();
}

void receiveAndPlayAudio() {
  WiFiClient client;
  if (!client.connect(serverip.c_str(), AUDIO_TCP_PORT)) return;

  uint8_t buffer[BUFFER_SIZE];
  while (client.connected()) {
    int len = client.read(buffer, BUFFER_SIZE);
    if (len > 0) {
      size_t bytesWritten;
      i2s_write(I2S_SPK_PORT, buffer, len, &bytesWritten, portMAX_DELAY);
    }
  }
  client.stop();
}

void setupMicI2S() {
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = 1024,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };

  i2s_pin_config_t pin_config = {
    .bck_io_num = I2S_MIC_SCK,
    .ws_io_num = I2S_MIC_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_MIC_SD
  };

  i2s_driver_install(I2S_MIC_PORT, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_MIC_PORT, &pin_config);
  //i2s_zero_dma_buffer(I2S_MIC_PORT);
}

void setupSpeakerI2S() {
  i2s_config_t spk_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
    .sample_rate = 16000,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_MSB,
    .intr_alloc_flags = 0,
    .dma_buf_count = 8,
    .dma_buf_len = 64,
    .use_apll = false,
    .tx_desc_auto_clear = true,
    .fixed_mclk = 0
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

void setup() {
  setenv("TZ", "CETCEST,M3.5.0,M10.5.0/3", 1);
  tzset();

  // Setup screen
  Wire.begin(OLED_SDA, OLED_SCL);
  // esp_wifi_set_max_tx_power(40); // Set TX power to 10 dBm to half max power to reduce electricity consumption but also reduce range and speed
  if (display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    display.ssd1306_command(SSD1306_DISPLAYON);
    display.setTextColor(SSD1306_WHITE);
  }
  
  dht.begin();

  // Setup touch sensor
  pinMode(TOUCH_PIN, INPUT);
  //esp_sleep_enable_ext0_wakeup(TOUCH_PIN, 1);

  // Setup motion sensor wake up
  //pinMode(MOTION_PIN, INPUT);
  //esp_sleep_enable_ext0_wakeup(MOTION_PIN, 1);
  
  /*esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();
  if (wakeup_reason == ESP_SLEEP_WAKEUP_EXT0) {
    displayStatusOnScreen();
    delay(30000);
    deepsleep();
    return;
  }*/
  display.setTextSize(1);

  // Reload config from persistent mem (EEPROM)
  prefs.begin("config", false);
  serverip = "192.168.1.24";//prefs.getString("serverip");
  prefs.end();

  // Setup WIFI
  if (serverip == "" || WiFi.SSID() == "") {
    WiFiManager wm;
    WiFiManagerParameter custom_server("serverip", "Server IP", "", 20);
    wm.addParameter(&custom_server);
    displayText("Configuration mode");

    if (!wm.autoConnect("ESP32_Config")) {
      displayText("Failed to enter config mode");
      return;
    }
    
    prefs.begin("config", false);
    prefs.putString("serverip", custom_server.getValue());
    prefs.end();
  }  else {
    displayText("Connect to WIFI");
    WiFi.begin();
  }

  if (WiFi.waitForConnectResult() != WL_CONNECTED) {
    displayText("Cannot connect to WIFI");
    return;
  }

  displayText("configure mic i2s");
  setupMicI2S();

  //displayText("configure speaker i2s");
  //setupSpeakerI2S();

  displayText(serverip.c_str());
  //configTime(0, 0, "pool.ntp.org");

  /*displayText("Going to send report");
  delay(5000);

  //report();

  displayText("Report send, going to sleep");
  delay(5000);

  displayText("Going to sleep");
  deepsleep();*/
}

void loop() {
  int touchState = digitalRead(TOUCH_PIN);
  if (touchState == HIGH) {
    displayText("Record");
    sendMicAudio();
  } else {
    displayText("Sleeping");
  }
}

/*
if (digitalRead(RESET_PIN) == LOW) {
  prefs.begin("config", false);
  prefs.clear();
  prefs.end();
  ESP.restart();
}
*/