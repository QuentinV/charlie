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

Preferences prefs;
String serverip;

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);
DHT dht(DHTPIN, DHTTYPE);

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

void deepsleep() {
  strip.clear();
  strip.show();
  display.clearDisplay();
  display.display();
  display.ssd1306_command(SSD1306_DISPLAYOFF);

  esp_sleep_enable_timer_wakeup(SLEEP_TIME);
  esp_deep_sleep_start();
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
  
  esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();
  if (wakeup_reason == ESP_SLEEP_WAKEUP_EXT0) {
    displayStatusOnScreen();
    delay(30000);
    deepsleep();
    return;
  }
  
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

  displayText("Going to send report");
  delay(5000);

  //report();

  displayText("Report send, going to sleep");
  delay(5000);

  displayText("Going to sleep");
  deepsleep();
}

void loop() {}

/*
if (digitalRead(RESET_PIN) == LOW) {
  prefs.begin("config", false);
  prefs.clear();
  prefs.end();
  ESP.restart();
}
*/