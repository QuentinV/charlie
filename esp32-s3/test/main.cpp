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
#include <Adafruit_NeoPixel.h>
#include <DHT.h>
#include "time.h"
#include "driver/i2s.h"

#define DATA_UDP_PORT 12346
#define AUDIO_UDP_PORT 12345
#define AUDIO_TCP_PORT 12345

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
#define OLED_SDA      GPIO_NUM_21
#define OLED_SCL      GPIO_NUM_20

#define DHTPIN GPIO_NUM_14
#define DHTTYPE DHT22

#define MOTION_PIN GPIO_NUM_1
#define TOUCH_PIN GPIO_NUM_13

#define I2S_MIC_PORT I2S_NUM_0
#define I2S_MIC_WS  GPIO_NUM_41
#define I2S_MIC_SD  GPIO_NUM_40
#define I2S_MIC_SCK GPIO_NUM_42

#define I2S_SPK_PORT I2S_NUM_1
#define I2S_SPK_LRC GPIO_NUM_47
#define I2S_SPK_BCLK GPIO_NUM_46
#define I2S_SPK_DIN GPIO_NUM_45

#define SAMPLE_RATE 8000
#define BUFFER_SIZE 512

#define MIC_THRESHOLD 2000000
#define WAKE_EXTENSION_MS 1800 // 30min
#define MOTION_SENSOR_RETRIGGER 60
#define SENSOR_REPORT_INTERVAL 3600 // 1h
#define SCREEN_DISPLAY_TIME 10

Preferences prefs;
String serverip;

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
Adafruit_NeoPixel pixels(1, GPIO_NUM_48, NEO_GRB + NEO_KHZ800);
DHT dht(DHTPIN, DHTTYPE);
WiFiServer server(AUDIO_TCP_PORT);

unsigned long motionStart = 0;
unsigned long wakeFromTouch = 0;
unsigned long lastSensorReport = 0;
unsigned long touchStart = 0;
bool mute = false;
int beingSleepHour;
int endSleepHour;

void displayText(String text) {
  display.clearDisplay();
  display.setCursor(0, 10);
  display.println(text);
  display.display();
}

void sendState(bool motiondetected) {
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity(); 

  try
  {
    WiFiUDP udp;
    udp.beginPacket(serverip.c_str(), DATA_UDP_PORT);
    udp.printf("%s;%.1f;%.1f;%d", WiFi.macAddress(), temp, hum, motiondetected ? 1 : 0);
    udp.endPacket();
  } catch(const std::exception& e) {
    //
  }
}

void displayStatusOnScreen(tm *timeinfo) {
  display.ssd1306_command(SSD1306_DISPLAYON);

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
  display.setTextSize(3);
  char timestr[16];
  strftime(timestr, sizeof(timestr), "%H:%M", timeinfo);
  int16_t x, y;
  uint16_t w, h;
  display.getTextBounds(timestr, 0, 0, &x, &y, &w, &h);
  display.setCursor((SCREEN_WIDTH - w) / 2, (SCREEN_HEIGHT - h) / 2);
  display.print(timestr);
  display.display();

  display.setTextSize(1);
}

bool isSleepHour() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return false;
  return timeinfo.tm_hour >= 0 && timeinfo.tm_hour < 8;
}

void deepsleep() {
  displayText("Going to sleep");
  display.ssd1306_command(SSD1306_DISPLAYOFF);

  pixels.setPixelColor(0, pixels.Color(0, 0, 0));
  pixels.show();

  esp_sleep_enable_timer_wakeup(3600000000);
  esp_deep_sleep_start();
}

bool sendMicAudio() {
  int32_t samples[BUFFER_SIZE];
  size_t bytes_read = 0;
  i2s_read(I2S_MIC_PORT, samples, sizeof(int32_t) * BUFFER_SIZE, &bytes_read, portMAX_DELAY);
  
  int64_t sum = 0;
  for (int i = 0; i < BUFFER_SIZE; i++) {
    sum += abs(samples[i]);
  }

  int rms = sum / BUFFER_SIZE;
  if (rms > MIC_THRESHOLD) {
    WiFiUDP udp;
    udp.beginPacket(serverip.c_str(), AUDIO_UDP_PORT);
    udp.write((uint8_t*)samples, bytes_read);
    udp.endPacket();
    return true;
  }
  return false;
}

void receiveAndPlayAudio() {
  WiFiClient client = server.available();
  if (!client) return;

  uint8_t buffer[BUFFER_SIZE];
  while (client.connected()) {
    int len = client.read(buffer, sizeof(buffer));
    if (len > 0) {
      size_t bytes_written;
      i2s_write(I2S_SPK_PORT, buffer, len, &bytes_written, portMAX_DELAY);
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
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
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

void setup() {
  setenv("TZ", "CETCEST,M3.5.0,M10.5.0/3", 1);
  tzset();

  Wire.begin(OLED_SDA, OLED_SCL);
  if (display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    display.ssd1306_command(SSD1306_DISPLAYON);
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
  }
  
  pixels.begin();
  pixels.setBrightness(50);

  dht.begin();
  pinMode(MOTION_PIN, INPUT);
  pinMode(TOUCH_PIN, INPUT);

  esp_sleep_enable_ext0_wakeup(TOUCH_PIN, HIGH);
  esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();
  
  // Reload config from persistent mem (EEPROM)
  prefs.begin("config", false);
  serverip = "192.168.1.24";//prefs.getString("serverip", "192.168.1.24");
  beingSleepHour = 0; //prefs.getInt("beingSleepHour", 0);
  endSleepHour = 8; //prefs.getInt("endSleepHour", 8);
  prefs.end();

  // Setup WIFI
  /*if (serverip == "") {
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
    prefs.putInt("beingSleepHour", String(custom_server.getValue()).toInt());
    prefs.putInt("endSleepHour", String(custom_server.getValue()).toInt());
    prefs.end();
  } else {
    WiFi.begin();
  }*/
  WiFi.begin();

  if (WiFi.waitForConnectResult() != WL_CONNECTED) {
    displayText("Cannot connect to WIFI");
    return;
  }

  setupMicI2S();
  setupSpeakerI2S();
  server.begin();

  displayText("Fetch time");
  configTime(3600, 0, "pool.ntp.org", "time.nist.gov", "time.google.com");
  struct tm timeinfo;
  getLocalTime(&timeinfo);
  
  displayText(serverip);

  if (wakeup_reason == ESP_SLEEP_WAKEUP_EXT0) {
    wakeFromTouch = time(NULL);
  }

  //display.ssd1306_command(SSD1306_DISPLAYOFF);
}

void loop() {
  time_t t = time(NULL);
  struct tm *timeinfo = localtime(&t);
  bool sleepHour = timeinfo->tm_hour >= beingSleepHour && timeinfo->tm_hour < endSleepHour;

  //displayText(String(t));

  if (t - lastSensorReport > SENSOR_REPORT_INTERVAL) {
    lastSensorReport = t;
    sendState(false);
  }

  int touch = digitalRead(TOUCH_PIN);
  if (touch && touchStart == 0) {
    touchStart = t;
  } else if (touch == 0 && touchStart != 0) {
    if (t - touchStart > 5) {
      deepsleep();
      return;
    }
    mute = !mute;
    
    pixels.setPixelColor(0, pixels.Color(mute ? 255 : 0, 0, 0));
    pixels.show();

    touchStart = 0;
  }
  
  if (sleepHour && t - wakeFromTouch > WAKE_EXTENSION_MS) {
    deepsleep();
    return;
  }

  if (digitalRead(MOTION_PIN) && t - motionStart > MOTION_SENSOR_RETRIGGER) {
    motionStart = t;
    displayStatusOnScreen(timeinfo);
    sendState(true);
  } else if (t - motionStart > SCREEN_DISPLAY_TIME) {
    display.ssd1306_command(SSD1306_DISPLAYOFF);
  }

  if (mute) {
    delay(1000);
    return;
  }
  
  if (!sendMicAudio()) {
    receiveAndPlayAudio();
  }
}