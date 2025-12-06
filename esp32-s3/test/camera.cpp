#include <Arduino.h>
#include "esp_system.h"
#include "esp_heap_caps.h"
#include <WiFiManager.h>
#include <WiFiUdp.h>
#include <WiFi.h>
#include <Preferences.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#define sensor_t adafruit_sensor_t
#include <Adafruit_Sensor.h>
#undef sensor_t
#include <Adafruit_NeoPixel.h>
#include <DHT.h>
#include <PubSubClient.h>
#include "time.h"
#include "driver/i2s.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_camera.h"
#include "esp_http_server.h"

#define EIDSP_QUANTIZE_FILTERBANK   0
#include <charlie_inferencing.h>

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
#define TOUCH_PIN GPIO_NUM_42

#define I2S_MIC_PORT I2S_NUM_0
#define I2S_MIC_WS  GPIO_NUM_41
#define I2S_MIC_SD  GPIO_NUM_40
#define I2S_MIC_SCK GPIO_NUM_2

#define I2S_SPK_PORT I2S_NUM_1
#define I2S_SPK_LRC GPIO_NUM_47
#define I2S_SPK_BCLK GPIO_NUM_46
#define I2S_SPK_DIN GPIO_NUM_45

// Camera
#define XCLK_GPIO_NUM    15
#define SIOD_GPIO_NUM    4
#define SIOC_GPIO_NUM    5
#define Y9_GPIO_NUM      16
#define Y8_GPIO_NUM      17
#define Y7_GPIO_NUM      18
#define Y6_GPIO_NUM      12
#define Y5_GPIO_NUM      10
#define Y4_GPIO_NUM      8
#define Y3_GPIO_NUM      9
#define Y2_GPIO_NUM      11
#define VSYNC_GPIO_NUM   6
#define HREF_GPIO_NUM    7
#define PCLK_GPIO_NUM    13

#define SAMPLE_RATE 8000
#define BUFFER_SIZE 512

#define MIC_THRESHOLD 2000000
#define WAKE_EXTENSION_MS 1800 // 30min
#define MOTION_SENSOR_RETRIGGER 60
#define SENSOR_REPORT_INTERVAL 3600 // 1h
#define SCREEN_DISPLAY_TIME 10

// preferences
Preferences prefs;
String serverip;

// Objects
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
Adafruit_NeoPixel pixels(1, GPIO_NUM_48, NEO_GRB + NEO_KHZ800);
DHT dht(DHTPIN, DHTTYPE);
WiFiServer server(AUDIO_TCP_PORT);
WiFiClient espClient;
PubSubClient client(espClient);

// States
unsigned long motionStart = 0;
unsigned long touchStart = 0;
bool mute = false;

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
bool record_status = true;

// Task handles
TaskHandle_t mqttTaskHandle;
TaskHandle_t memoryPrintHandle;
TaskHandle_t touchTaskHandle;
TaskHandle_t motionSensorHandle;
TaskHandle_t receivePlayAudioHandle;
TaskHandle_t wakeUpWordHandle;

void displayText(String text) {
  display.clearDisplay();
  display.setCursor(0, 10);
  display.println(text);
  display.display();
}

bool isSleepHour() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return false;
  return timeinfo.tm_hour >= 0 && timeinfo.tm_hour < 8;
}

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

void sendCurrentState(bool motiondetected) {
  if (client.connected()) {
    String data = fetchFormattedStateData();
    if ( motiondetected ) {
      data = data + ";true";
    }
    client.publish("echo/status", data.c_str());
  }
}

int i2s_init(uint32_t sampling_rate) {
  // Start listening for audio: MONO @ 8/16KHz
  i2s_config_t i2s_config = {
      .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX | I2S_MODE_TX),
      .sample_rate = sampling_rate,
      .bits_per_sample = (i2s_bits_per_sample_t)16,
      .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
      .communication_format = I2S_COMM_FORMAT_STAND_I2S,
      .intr_alloc_flags = 0,
      .dma_buf_count = 8,
      .dma_buf_len = 512,
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
  esp_err_t ret = 0;

  ret = i2s_driver_install((i2s_port_t)1, &i2s_config, 0, NULL);
  if (ret != ESP_OK) {
    ei_printf("Error in i2s_driver_install");
  }

  ret = i2s_set_pin((i2s_port_t)1, &pin_config);
  if (ret != ESP_OK) {
    ei_printf("Error in i2s_set_pin");
  }

  ret = i2s_zero_dma_buffer((i2s_port_t)1);
  if (ret != ESP_OK) {
    ei_printf("Error in initializing dma buffer with 0");
  }

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

void capture_samples(void* arg) {
  const int32_t i2s_bytes_to_read = (uint32_t)arg;
  size_t bytes_read = i2s_bytes_to_read;

  while (record_status) {
    /* read data at once from i2s */
    i2s_read((i2s_port_t)1, (void*)sampleBuffer, i2s_bytes_to_read, &bytes_read, 100);

    if (bytes_read <= 0) {
      ei_printf("Error in I2S read : %d", bytes_read);
    }
    else {
        if (bytes_read < i2s_bytes_to_read) {
          ei_printf("Partial I2S read");
        }

        // scale the data (otherwise the sound is too quiet)
        for (int x = 0; x < i2s_bytes_to_read/2; x++) {
            sampleBuffer[x] = (int16_t)(sampleBuffer[x]) * 8;
        }

        // TODO "record_status" is the same as "mute" and then task needs to be restarted if delete when unmute
        if (record_status) {
            audio_inference_callback(i2s_bytes_to_read);
        }
        else {
            break;
        }
    }
  }
  vTaskDelete(NULL);
}

bool microphone_inference_start(uint32_t n_samples) {
  inference.buffer = (int16_t *)malloc(n_samples * sizeof(int16_t));

  if(inference.buffer == NULL) {
      return false;
  }

  inference.buf_count  = 0;
  inference.n_samples  = n_samples;
  inference.buf_ready  = 0;

  if (i2s_init(EI_CLASSIFIER_FREQUENCY)) {
      ei_printf("Failed to start I2S!");
  }

  ei_sleep(100);

  record_status = true;

  xTaskCreate(capture_samples, "CaptureSamples", 1024 * 32, (void*)sample_buffer_size, 10, NULL);

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

void setupCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = -1;
  config.pin_reset    = -1;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  config.frame_size   = FRAMESIZE_VGA;   // try FRAMESIZE_HD for higher res
  config.jpeg_quality = 12;              // lower = better quality
  config.fb_count     = 2;

  if (esp_camera_init(&config) != ESP_OK) {
    Serial.println("Camera init failed");
    return;
  }
}

esp_err_t stream_handler(httpd_req_t *req) {
  camera_fb_t *fb = NULL;
  esp_err_t res = ESP_OK;

  // Set response type to multipart MJPEG
  res = httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=frame");
  if (res != ESP_OK) return res;

  while (true) {
    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("Camera capture failed");
      res = ESP_FAIL;
    } else {
      // Write multipart frame
      char part_buf[64];
      size_t hlen = snprintf(part_buf, 64,
        "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
        fb->len);

      res = httpd_resp_send_chunk(req, part_buf, hlen);
      if (res == ESP_OK) {
        res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
      }
      if (res == ESP_OK) {
        res = httpd_resp_send_chunk(req, "\r\n", 2);
      }

      esp_camera_fb_return(fb);
    }

    if (res != ESP_OK) {
      break; // exit loop if client disconnects
    }
  }
  return res;
}

void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;

  httpd_handle_t server = NULL;
  if (httpd_start(&server, &config) == ESP_OK) {
    httpd_uri_t stream_uri = {
      .uri       = "/stream",
      .method    = HTTP_GET,
      .handler   = stream_handler,
      .user_ctx  = NULL
    };
    httpd_register_uri_handler(server, &stream_uri);
  }
}

void memoryPrintTask(void *pvParameters) {
  vTaskDelay(5000 / portTICK_PERIOD_MS);
  for (;;) {
    Serial.printf("Free heap: %d bytes\n", esp_get_free_heap_size());
    Serial.printf("Largest free block: %d bytes\n", heap_caps_get_largest_free_block(MALLOC_CAP_DEFAULT));
    Serial.printf("Free internal RAM: %d bytes\n", heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
    Serial.printf("Free PSRAM: %d bytes\n", heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
    Serial.printf("memoryPrintTask - high water mark: %d words\n", uxTaskGetStackHighWaterMark(NULL));
    vTaskDelay(5000 / portTICK_PERIOD_MS);
  }
}

void mqttTask(void *pvParameters) {
  vTaskDelay(5000 / portTICK_PERIOD_MS);
  for (;;) {
    if (!client.connected()) {
      mqttReconnect();
    }
    client.loop();
    sendCurrentState(false);
    Serial.printf("mqttTask - high water mark: %d words\n", uxTaskGetStackHighWaterMark(NULL));
    vTaskDelay(1800000 / portTICK_PERIOD_MS);
  }
}

void handleTouchTask(void* arg) {
  for (;;) {
    int touch = digitalRead(TOUCH_PIN);

    if (touch && touchStart == 0) {
      time_t t = time(NULL);
      touchStart = t;
    } else if (touch == 0 && touchStart != 0) {
      mute = !mute;
      
      pixels.setPixelColor(0, pixels.Color(mute ? 255 : 0, 0, 0));
      pixels.show();

      touchStart = 0;
      Serial.printf("handleTouchTask - high water mark: %d words\n", uxTaskGetStackHighWaterMark(NULL));
    }

    vTaskDelay(1000 / portTICK_PERIOD_MS);
  }
}

void handleMotionSensorTask(void *arg) {
  for (;;) {
    time_t t = time(NULL);
    if (digitalRead(MOTION_PIN) && t - motionStart > MOTION_SENSOR_RETRIGGER) {
      motionStart = t;

      struct tm *timeinfo = localtime(&t);
      displayStatusOnScreen(timeinfo);

      sendCurrentState(true);
    } else if (t - motionStart > SCREEN_DISPLAY_TIME) {
      display.ssd1306_command(SSD1306_DISPLAYOFF);
    }
    Serial.printf("handleMotionSensorTask - high water mark: %d words\n", uxTaskGetStackHighWaterMark(NULL));
    vTaskDelay(1000 / portTICK_PERIOD_MS);
  }
}

void receiveAndPlayAudioTask(void *arg) {
  for (;;) {
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
}

void wakeUpWordTask(void *arg) {
  for (;;) {
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

    #if EI_CLASSIFIER_HAS_ANOMALY == 1
        ei_printf("    anomaly score: ");
        ei_printf_float(result.anomaly);
        ei_printf("\n");
    #endif
  }
 
  /*
  TODO
  Check wake up word detected
  Stop catpure
  record and send audio to server
  Detect silence
  Resume capture at the end of speach to listen for new command
  */

  /*
    float confidence = result.classification[0].value;
    if (confidence > 0.8f) {
        onWakeWordDetected();
    }
  */

  /*
  if (strcmp(label, "wakeword") == 0 && value > 0.8f) {
        onWakeWordDetected();   // <-- Call your function here
    }
  */
}

/*
bool sendMicAudioTask(void *arg) {
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
}*/

void setup() {
  Serial.begin(115200);

  printf("Hello");

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

  // Reload config from persistent mem (EEPROM)
  prefs.begin("config", false);
  serverip = "192.168.1.24";//prefs.getString("serverip", "192.168.1.24");
  prefs.end();

  WiFi.begin();

  if (WiFi.waitForConnectResult() != WL_CONNECTED) {
    return;
  }

  setupSpeakerI2S();
  
  displayText("Fetch time");
  configTime(3600, 0, "pool.ntp.org", "time.nist.gov", "time.google.com");
  struct tm timeinfo;
  getLocalTime(&timeinfo);
  
  displayText(serverip);

  Serial.printf("Current IP: %s\n", WiFi.localIP().toString().c_str());

  // Setup MQTT
  client.setServer(serverip.c_str(), 1883);

  setupCamera();

  // Tasks
  startCameraServer();
  //xTaskCreate( mqttTask, "StateReporting", 1800, NULL, 1, &mqttTaskHandle );
  //xTaskCreate( memoryPrintTask, "MemoryPrint", 1700, NULL, 1, &memoryPrintHandle );
  //xTaskCreate( handleTouchTask, "TouchSensor", 1800, NULL, 1, &touchTaskHandle );
  //xTaskCreate( handleMotionSensorTask, "MotionSensor", 2200, NULL, 1, &motionSensorHandle );
  //xTaskCreate( receiveAndPlayAudioTask, "ReceivePlayAudio", 4096, NULL, 1, &receivePlayAudioHandle );
  //xTaskCreate( wakeUpWordTask, "WakeUpWord", 4096, NULL, 1, &wakeUpWordHandle );
  /*if (microphone_inference_start(EI_CLASSIFIER_RAW_SAMPLE_COUNT) == false) {
      ei_printf("ERR: Could not allocate audio buffer (size %d), this could be due to the window length of your model\r\n", EI_CLASSIFIER_RAW_SAMPLE_COUNT);
      return;
  }*/

}

void loop() { 
}