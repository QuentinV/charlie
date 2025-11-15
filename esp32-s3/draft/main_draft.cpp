#include <Arduino.h>
#include "esp_heap_caps.h"
#include <WiFiManager.h>
#include <WiFiUdp.h>
#include <WiFi.h>
#include <Preferences.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_NeoPixel.h>
#include <Adafruit_Sensor.h>
#include <DHT.h>
#include "time.h"
#include "driver/i2s.h"

extern "C" {
  #include "picovoice.h"
  #include "pv_porcupine.h"
  #include "pv_porcupine_params.h"
}

#define DEVICE_NAME "c-echo-1"
#define UDP_PORT 60555
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

#define I2S_WS  GPIO_NUM_6
#define I2S_SD  GPIO_NUM_4
#define I2S_SCK GPIO_NUM_5
#define SAMPLE_RATE 16000

#define ACCESS_KEY "test"
#define WAKE_WORD_PATH "/spiffs/charlie_fr.ppn"
#define MODEL_PATH "/spiffs/porcupine_params.pv"

Preferences prefs;
String serverip;

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);
DHT dht(DHTPIN, DHTTYPE);

pv_porcupine_t *porcupine = NULL;
bool screenOn = false;
unsigned long screenTimer = 0;
const unsigned long screenDuration = 20000;

void displayText(String text) {
  display.clearDisplay();
  display.setCursor(0, 10);
  display.println(text);
  display.display();
}

void setColor(uint16_t n, uint8_t r, uint8_t g, uint8_t b) {
  strip.setPixelColor(n, strip.Color(r, g, b));
  strip.show();
}

void setupI2S() {
  i2s_config_t i2s_config = {
    .mode = I2S_MODE_MASTER | I2S_MODE_RX,
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_I2S_MSB,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = 512,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };

  i2s_pin_config_t pin_config = {
    .bck_io_num = I2S_SCK,
    .ws_io_num = I2S_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_SD
  };

  i2s_driver_install(I2S_NUM_0, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pin_config);
  i2s_zero_dma_buffer(I2S_NUM_0);
}

void setupPorcupine() {
  const char *keyword_paths[] = { WAKE_WORD_PATH };
  const float sensitivities[] = { 0.5f };

  pv_status_t status = pv_porcupine_init(
    ACCESS_KEY,
    MODEL_PATH,
    1,
    keyword_paths,
    sensitivities,
    &porcupine
  );
  /*if (status != PV_STATUS_SUCCESS) {
    Serial.println("Porcupine init failed");
    while (true);
  }*/
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
  setColor(4, 0, 0, 255);

  float temp = dht.readTemperature();
  float hum  = dht.readHumidity(); 

  WiFiUDP udp;
  udp.beginPacket(serverip.c_str(), UDP_PORT);
  udp.printf("%s:%.1f:%.1f", DEVICE_NAME, temp, hum);
  udp.endPacket();

  setColor(4, 0, 0, 0);
}

void setup() {
  strip.begin();
  strip.setBrightness(1);

  setenv("TZ", "CETCEST,M3.5.0,M10.5.0/3", 1);
  tzset();

  // Setup screen
  Wire.begin(OLED_SDA, OLED_SCL);
  if (display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    display.ssd1306_command(SSD1306_DISPLAYON);
    display.setTextColor(SSD1306_WHITE);
  }
  
  dht.begin();
  setColor(3, 0, 255, 0);

  // Setup motion sensor wake up
  pinMode(MOTION_PIN, INPUT);
  setColor(2, 0, 255, 0);
  esp_sleep_enable_ext0_wakeup(MOTION_PIN, 1);
  
  display.setTextSize(1);

  // Reload config from persistent mem (EEPROM)
  prefs.begin("config", false);
  serverip = prefs.getString("serverip");
  prefs.end();

  setColor(0, 0, 255, 0);

  // Setup WIFI
  if (serverip == "" || WiFi.SSID() == "") {
    WiFiManager wm;
    WiFiManagerParameter custom_server("serverip", "Server IP", "", 20);
    wm.addParameter(&custom_server);
    displayText("Configuration mode");

    setColor(1, 255, 0, 255);

    if (!wm.autoConnect("ESP32_Config")) {
      displayText("Failed to enter config mode");
      setColor(1, 255, 0, 0);
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
    setColor(1, 0, 255, 255);
    return;
  }

  //configTime(0, 0, "pool.ntp.org");

  displayText("Configured");
  setColor(1, 0, 255, 0);

  setColor(4, 0, 255, 255);

  // Setup mic
  setupI2S();
  setupPorcupine();

  setColor(4, 0, 255, 0);
}

void loop() {
  // Motion triggers screen
  if (digitalRead(MOTION_PIN) == HIGH && !screenOn) {
    screenOn = true;
    screenTimer = millis();
    displayStatusOnScreen();
  }

  // Wake word detection
  int16_t frame[pv_porcupine_frame_length()];
  size_t bytes_read;
  i2s_read(I2S_NUM_0, (void *)frame, sizeof(int16_t) * pv_porcupine_frame_length(), &bytes_read, portMAX_DELAY);

  if (bytes_read == sizeof(int16_t) * pv_porcupine_frame_length()) {
    int32_t result = -1;
    pv_status_t status = pv_porcupine_process(porcupine, frame, &result);
    if (status == PV_STATUS_SUCCESS && result >= 0) {
      //Serial.println("Wake word detected!");
      screenOn = true;
      screenTimer = millis();
      displayStatusOnScreen();
    }
  }

  // Turn off screen after timeout
  if (screenOn && millis() - screenTimer > screenDuration) {
    display.clearDisplay();
    display.display();
    screenOn = false;
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

/*
Upload these to /data and run pio run --target uploadfs:

porcupine_params.pv

hey_pico.ppn
*/