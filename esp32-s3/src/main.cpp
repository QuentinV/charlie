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
#include <PubSubClient.h>
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

// preferences
Preferences prefs;
char* serverip;

// Objects
DHT dht(DHTPIN, DHTTYPE);

WiFiClient espClient;
PubSubClient client(espClient);

// Task handles
TaskHandle_t mqttTaskHandle;

void mqttReconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    if (client.connect("EchoClient")) {
      Serial.println("connected");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 min");
      vTaskDelay(300000 / portTICK_PERIOD_MS);
    }
  }
}

String fetchFormattedStateData() {
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity(); 

  return 
    String(WiFi.macAddress()) + ";" +
    String(temp, 1) + ";" +
    String(hum, 1);
}

void mqttTask(void *pvParameters) {
  for (;;) {
    if (!client.connected()) {
      mqttReconnect();
    }
    client.loop();
    client.publish("echo/status", fetchFormattedStateData().c_str());
    vTaskDelay(1800000 / portTICK_PERIOD_MS);
  }
}

void setup() {
  Serial.begin(115200);

  setenv("TZ", "CETCEST,M3.5.0,M10.5.0/3", 1);
  tzset();

  dht.begin();
  pinMode(MOTION_PIN, INPUT);
  pinMode(TOUCH_PIN, INPUT);

  // Reload config from persistent mem (EEPROM)
  prefs.begin("config", false);
  serverip = "192.168.1.24";//prefs.getString("serverip", "192.168.1.24");
  prefs.end();

  WiFi.begin();

  if (WiFi.waitForConnectResult() != WL_CONNECTED) {
    return;
  }

  // Setup MQTT
  client.setServer(serverip, 1883);

  // Tasks
  xTaskCreate( mqttTask, "StateReporting", 4096, NULL, 1, &mqttTaskHandle );
}

void loop() { 
}