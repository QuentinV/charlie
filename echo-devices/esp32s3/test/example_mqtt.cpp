#include <WiFi.h>
#include <PubSubClient.h>

// WiFi and MQTT settings
const char* ssid = "yourSSID";
const char* password = "yourPASS";
const char* mqtt_server = "192.168.1.100"; // Broker IP

WiFiClient espClient;
PubSubClient client(espClient);

// Task handles
TaskHandle_t mqttTaskHandle;

// MQTT callback
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.print("Message arrived [");
  Serial.print(topic);
  Serial.print("] ");
  for (int i = 0; i < length; i++) {
    Serial.print((char)payload[i]);
  }
  Serial.println();
}

// Reconnect logic
void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    if (client.connect("ESP32Client")) {
      Serial.println("connected");
      client.subscribe("esp32/test");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      vTaskDelay(5000 / portTICK_PERIOD_MS);
    }
  }
}

// MQTT task
void mqttTask(void *pvParameters) {
  for (;;) {
    if (!client.connected()) {
      reconnect();
    }
    client.loop(); // process incoming/outgoing MQTT
    client.publish("esp32/test", "Hello from ESP32 FreeRTOS");
    vTaskDelay(2000 / portTICK_PERIOD_MS); // publish every 2s
  }
}

void setup() {
  Serial.begin(115200);

  // Connect WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("WiFi connected");

  // Setup MQTT
  client.setServer(mqtt_server, 1883);
  client.setCallback(mqttCallback);

  // Create MQTT FreeRTOS task
  xTaskCreatePinnedToCore(
    mqttTask,          // Task function
    "MQTT Task",       // Name
    4096,              // Stack size
    NULL,              // Parameters
    1,                 // Priority
    &mqttTaskHandle,   // Task handle
    1                  // Run on core 1
  );
}

void loop() {
  // Empty: FreeRTOS scheduler runs tasks
}
