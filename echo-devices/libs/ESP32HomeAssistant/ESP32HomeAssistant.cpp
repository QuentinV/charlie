#include "ESP32HomeAssistant.h"
#include <charlie-2_inferencing.h>
#include <esp_wifi.h>

ESP32HomeAssistant* ESP32HomeAssistant::instance = nullptr;

static int ei_get_data_static(size_t offset, size_t length, float *out_ptr) {
    return ESP32HomeAssistant::instance->_ei_get_sliding_window_data(offset, length, out_ptr);
}

static void wsTask(void *arg) {
    ESP32HomeAssistant::instance->_wsTask(arg);
}

static void listenAndSendTask(void *arg) {
    ESP32HomeAssistant::instance->_listenAndSendTask(arg);
}

static void onWebSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
    ESP32HomeAssistant::instance->_onWebSocketEvent(type, payload, length);
}

static void displayStatusOnScreenTask(void *arg) {
    ESP32HomeAssistant::instance->_displayStatusOnScreenTask(arg);
}

ESP32HomeAssistant::ESP32HomeAssistant(const HAConfig& cfg)
    : _cfg(cfg)
{
    instance = this;
}

void ESP32HomeAssistant::_runOTA() {
    setLed(255, 0, 255);
    vTaskDelete(this->taskWebSocketHandle);
    vTaskDelete(this->listenAndSendHandle);

    serverip = "192.168.1.17";
    WiFiClient client;
    t_httpUpdate_return ret = httpUpdate.update( client, "http://" + serverip + ":9300/api/echo/" + this->_cfg.deviceType + "/latest/firmware.bin" );

    switch (ret) {
        case HTTP_UPDATE_FAILED:
            this->setLed(255, 0, 0);
            this->webSocket.sendTXT(("OTA_FAILED: ") + httpUpdate.getLastErrorString());
            break;

        case HTTP_UPDATE_NO_UPDATES:
            this->setLed(0, 0, 0);
            webSocket.sendTXT("No update available");
            break;

        case HTTP_UPDATE_OK:
            this->setLed(0, 0, 255);
            webSocket.sendTXT("Update OK, rebooting...");
            break;
    }
    
    delay(3000);
    ESP.restart();
}

void ESP32HomeAssistant::_setWakeUpWordAccuracy(float accuracy) {
    this->_cfg.WAKE_UP_WORD_ACCURACY = accuracy;
}

void ESP32HomeAssistant::_setServerIp(String serverip) {
    this->serverip = serverip;
    this->_prefs.putString("serverIp", serverip);
}

void ESP32HomeAssistant::_setupWiFi() {
    Serial.println("Loading wifi");
    this->_prefs.begin("config", false);
    this->serverip = this->_prefs.getString("serverIp", "");
    Serial.println("Loaded serverIp: " + this->serverip);

    WiFi.mode(WIFI_AP_STA);

    this->_wm.setConfigPortalBlocking(true);
    this->_wm.setDebugOutput(true);

    WiFiManagerParameter customServiceIp("serverIp", "Charlie server IP", this->serverip.c_str(), 16);
    this->_wm.addParameter(&customServiceIp);

    bool res = this->_wm.autoConnect(this->_cfg.apName, this->_cfg.apPassword);

    if (!res) {
        delay(3000);
        ESP.restart();
    }

    String serverIp = customServiceIp.getValue();
    if (serverIp.length() == 0) {
        this->_wm.startConfigPortal(this->_cfg.apName, this->_cfg.apPassword);
    }

    this->_prefs.putString("serverIp", serverIp);
    this->serverip = serverIp;

    this->_prefs.end();
}

void ESP32HomeAssistant::_playAudio(uint8_t* data, size_t len) {
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
    i2s_write(this->_cfg.I2S_SPK_PORT, data, len, &bytes_written, portMAX_DELAY);
}

void ESP32HomeAssistant::_onWebSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
    switch(type) {
        case WStype_DISCONNECTED:
            this->isWsConnected = false;
            break;
        case WStype_CONNECTED:
            this->isWsConnected = true;
            break;
        case WStype_TEXT:
            {
                String msg = String((char*)payload);
                int splitIndex = msg.indexOf(':');

                String command;
                String value;

                if (splitIndex != -1) {
                    command = msg.substring(0, splitIndex);
                    value = msg.substring(splitIndex + 1);
                } else {
                    command = msg;
                }

                if(command == "setServerIp") {
                    this->_setServerIp(value);
                } else if (command == "setWakeUpWordAccuracy") {
                    this->_setWakeUpWordAccuracy(value.toFloat());
                } else if (command == "OTA") {
                    this->_runOTA();
                } else {
                    this->displayText(msg);
                }
                break;    
            }
        case WStype_BIN:
            this->_playAudio(payload, length);
            break;
    }
}

int ESP32HomeAssistant::_setupMicI2S(uint32_t sampling_rate) {
    // Start listening for audio: MONO @ 8/16KHz
    i2s_config_t i2s_config = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
        .sample_rate = sampling_rate,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
        .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags = 0,
        .dma_buf_count = 80,
        .dma_buf_len = 512,
        .use_apll = false,
        .tx_desc_auto_clear = false,
        .fixed_mclk = -1
    };

    i2s_pin_config_t pin_config = {
        .bck_io_num = this->_cfg.I2S_MIC_SCK,
        .ws_io_num = this->_cfg.I2S_MIC_WS,
        .data_out_num = I2S_PIN_NO_CHANGE,
        .data_in_num = this->_cfg.I2S_MIC_SD
    };
    esp_err_t ret = 0;

    ret = i2s_driver_install(this->_cfg.I2S_MIC_PORT, &i2s_config, 0, NULL);
    if (ret != ESP_OK) {
        ei_printf("Error in i2s_driver_install");
    }

    ret = i2s_set_pin(this->_cfg.I2S_MIC_PORT, &pin_config);
    if (ret != ESP_OK) {
        ei_printf("Error in i2s_set_pin");
    }

    
    ret = i2s_set_clk(this->_cfg.I2S_MIC_PORT, sampling_rate, I2S_BITS_PER_SAMPLE_32BIT, I2S_CHANNEL_MONO);
    if (ret != ESP_OK) {
        ei_printf("Error in i2s_set_clk");
    }

    ret = i2s_zero_dma_buffer(this->_cfg.I2S_MIC_PORT);
    if (ret != ESP_OK) {
        ei_printf("Error in initializing dma buffer with 0");
    }

    ei_printf("Microphone configured");

    return int(ret);
}

bool ESP32HomeAssistant::_allocateInferenceBuffer(uint32_t n_samples) {
    ei_sleep(100);

    this->inference.buffer = (int16_t*)heap_caps_malloc(16000 * sizeof(int16_t), MALLOC_CAP_SPIRAM);
    this->inference_window = (int16_t*)heap_caps_malloc(16000 * sizeof(int16_t), MALLOC_CAP_SPIRAM);

    if (this->inference.buffer == NULL || this->inference_window == NULL) {
        Serial.println("PSRAM Allocation Failed!");
    } else {
        Serial.printf("Buffer moved to PSRAM. New Address: %p\n", (void*)this->inference_window);
    }

    if (this->inference.buffer == NULL) {
        return false;
    }

    this->inference.buf_count = 0;
    this->inference.n_samples = n_samples;

    return true;
} 

void ESP32HomeAssistant::_setupSpeakerI2S() {
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
        .bck_io_num = this->_cfg.I2S_SPK_BCLK,
        .ws_io_num = this->_cfg.I2S_SPK_LRC,
        .data_out_num = this->_cfg.I2S_SPK_DIN,
        .data_in_num = I2S_PIN_NO_CHANGE
    };

    i2s_driver_install(this->_cfg.I2S_SPK_PORT, &spk_config, 0, NULL);
    i2s_set_pin(this->_cfg.I2S_SPK_PORT, &spk_pins);
}

int ESP32HomeAssistant::_ei_get_sliding_window_data(size_t offset, size_t length, float *out_ptr) {
    for (size_t i = 0; i < length; i++) {
        out_ptr[i] = (float)this->inference_window[offset + i];
    }
    return 0;
}

void ESP32HomeAssistant::_listenAndSendTask(void *arg) {
    this->setLed(0, 0, 0);

    const size_t window = this->inference.n_samples;   // 16000
    const size_t hop    = 3200;                  // 200 ms @ 16 kHz
    float gain = 4.0f;

    const size_t chunk_samples = 512; 
    int32_t capture_raw32[chunk_samples];
    int16_t capture_pcm16[chunk_samples];

    esp_err_t capture_err;
    size_t capture_bytes_read;

    size_t samples_since_last_inference = 0;
    silenceStart = 0;
    time_t startTime = 0;
    bool sendMode = false;

    while (true) {
        vTaskDelay(pdMS_TO_TICKS(2));

        capture_err = i2s_read(
            this->_cfg.I2S_MIC_PORT,
            capture_raw32,
            sizeof(capture_raw32),
            &capture_bytes_read,
            portMAX_DELAY
        );

        if (capture_err != ESP_OK || capture_bytes_read == 0) {
            continue;
        }

        size_t frames_read = capture_bytes_read / sizeof(int32_t);

        int64_t sum = 0;
        // Convert 32‑bit I2S to 16‑bit PCM
        for (size_t i = 0; i < frames_read; i++) {
            capture_pcm16[i] = (int16_t)(capture_raw32[i] >> 15);
            capture_pcm16[i] = (int16_t)((float)capture_pcm16[i] * gain);
            sum += capture_pcm16[i];

             // Push to circular buffer (inference.buffer should be size 16000)
            this->inference.buffer[this->inference.buf_count] = capture_pcm16[i];
            this->inference.buf_count = (this->inference.buf_count + 1) % window;
        }

        if (sendMode) {
            time_t t = time(NULL);

            if (t - startTime > 5) {
                Serial.println("Max duration reached. Ending.");

                if (this->webSocket.isConnected())
                    this->webSocket.sendTXT("end");

                sendMode = false;
                this->setLed(0, 0, 0);
                continue;
            }

            // ===== RMS calculation =====
            int64_t sumsq = 0;
            for (size_t i = 0; i < frames_read; i++) {
                int32_t s = capture_pcm16[i];
                sumsq += (int64_t)s * s;
            }

            int rms = sqrt((double)sumsq / frames_read);
            //Serial.printf("rms = %d", rms);

            // ===== Silence detection =====
            if (rms < MIC_THRESHOLD_SOUND) {
                if (silenceStart == 0) {
                    silenceStart = t;
                } else if (t - silenceStart > MIC_DURATION_SILENCE) {
                    if (this->webSocket.isConnected())
                        this->webSocket.sendTXT("end");
                    sendMode = false;
                    this->setLed(0, 0, 0);
                    continue;
                }
            } else {
                silenceStart = 0;
            }

            if (this->webSocket.isConnected())
                this->webSocket.sendBIN((uint8_t*)capture_pcm16, frames_read * sizeof(int16_t));

        } else {
            samples_since_last_inference += frames_read;

            // Only run AI every 'hop' (200ms), but use the full 1s 'window'
            if (samples_since_last_inference >= hop) {
                samples_since_last_inference = 0;
                
                // Flatten circular buffer into a linear window for Edge Impulse
                for (size_t i = 0; i < window; i++) {
                    // Start reading from the oldest sample in the circular buffer
                    this->inference_window[i] = this->inference.buffer[(this->inference.buf_count + i) % window];
                }

                // DC removal
                int64_t sum = 0;
                for (size_t i = 0; i < window; i++) sum += this->inference_window[i];
                int32_t mean = sum / window;
                for (size_t i = 0; i < window; i++) this->inference_window[i] -= mean;

                // Build EI signal
                signal_t signal;
                signal.total_length = window;
                signal.get_data = &ei_get_data_static;

                ei_impulse_result_t result;
                run_classifier(&signal, &result, false);

                //Serial.printf("Classification = %f", result.classification[0].value);
                if ( result.classification[0].value > this->_cfg.WAKE_UP_WORD_ACCURACY) {
                    this->setLed(255, 255, 255);

                    sendMode = true;
                    silenceStart = 0;

                    if (this->webSocket.isConnected()) {
                        this->webSocket.sendTXT("start");
                        this->webSocket.sendBIN( (uint8_t*)this->inference_window, window * sizeof(int16_t) );
                    }
                    
                    startTime = time(NULL);
                }
            }
        }    
    }
}

void ESP32HomeAssistant::_wsTask(void *arg) {
    //if( this->_cfg.overwriteServerip ) {
    //    this->serverip = this->_cfg.overwriteServerip;
    //}
    this->webSocket.begin(this->serverip, WS_PORT, "/ws/echo");
    this->webSocket.onEvent(onWebSocketEvent);
    this->webSocket.setReconnectInterval(3000);
    this->webSocket.enableHeartbeat(120000, 30000, 2);

    while (true) {
        this->webSocket.loop();
        vTaskDelay(20 / portTICK_PERIOD_MS);
    }
}

void ESP32HomeAssistant::displayText(String msg) {
    if (!this->_cfg.screenEnabled) {
        return;
    }

    this->display->clearDisplay();
    this->display->setTextSize(1);

    int16_t x, y;
    uint16_t w, h;
    this->display->getTextBounds(msg.c_str(), 0, 0, &x, &y, &w, &h);
    this->display->setCursor((SCREEN_WIDTH - w) / 2, (SCREEN_HEIGHT - h) / 2);
    this->display->printf("%s", msg.c_str());
    this->display->display();
}

void ESP32HomeAssistant::_drawListeningScreen() {
    if (!this->_cfg.screenEnabled) {
        return;
    }
    this->display->clearDisplay();
    this->display->fillRoundRect(56, 10, 16, 28, 4, WHITE);
    this->display->fillCircle(64, 10, 10, WHITE);
    this->display->drawLine(64, 38, 64, 50, WHITE);
    this->display->drawLine(54, 50, 74, 50, WHITE);
    this->display->display();
}

void ESP32HomeAssistant::_displayStatusOnScreenTask(void *arg) {
    while(true) {
        time_t t = time(NULL);
        struct tm *timeinfo = localtime(&t);

        this->display->clearDisplay();

        // Middle centered
        this->display->setTextSize(3);
        char timestr[16];
        strftime(timestr, sizeof(timestr), "%H:%M", timeinfo);
        int16_t x, y;
        uint16_t w, h;
        this->display->getTextBounds(timestr, 0, 0, &x, &y, &w, &h);
        this->display->setCursor((SCREEN_WIDTH - w) / 2, (SCREEN_HEIGHT - h) / 2);
        this->display->print(timestr);
        this->display->display();

        this->display->setTextSize(1);

        // Compute milliseconds until next minute boundary
        int ms_left = ((59 - timeinfo->tm_sec) * 1000) + (1000 - (timeinfo->tm_sec * 1000 % 1000));
        if (ms_left < 0 || ms_left > 60000) {
            ms_left = 1000;
        }

        // Sleep until next minute
        vTaskDelay(pdMS_TO_TICKS(ms_left));
    }
  
}

void ESP32HomeAssistant::reset() {
  Serial.println("Reset......");
  this->_wm.resetSettings();
  this->_prefs.begin("config", false);
  this->_prefs.clear();
  this->_prefs.end();
  delay(4000);
  ESP.restart();
}

void ESP32HomeAssistant::printMemoryUsage() {
    Serial.println("--- Memory Report ---");
    
    // This is critical for DMA and Task Stacks
    size_t freeInternal = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
    size_t minFreeInternal = heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL);
    
    Serial.printf("Internal Free: %d bytes\n", freeInternal);
    Serial.printf("Internal Min Ever Free (High Water Mark): %d bytes\n", minFreeInternal);

    // PSRAM
    if (psramFound()) {
        size_t freePSRAM = heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
        Serial.printf("PSRAM Free: %d bytes\n", freePSRAM);
    } else {
        Serial.println("PSRAM not detected!");
    }

    // Tells you how close the current task is to a Stack Overflow
    Serial.printf("Current Task Stack Remaining: %d bytes\n", uxTaskGetStackHighWaterMark(NULL));
    Serial.println("----------------------");

    Serial.printf("Buffer Address: %p\n", (void*)this->inference_window);
    
    Serial.println("----------------------");
}

void ESP32HomeAssistant::setLed(uint8_t r, uint8_t g, uint8_t b) {
    this->_pixels->setPixelColor(0, this->_pixels->Color(r, g, b));
    this->_pixels->show();
}

void ESP32HomeAssistant::begin() {
    delay(5000);

    // NeoPixel init
    this->_pixels = new Adafruit_NeoPixel(
        _cfg.neoPixelCount, _cfg.neoPixelPin, NEO_GRB + NEO_KHZ800);
    this->_pixels->begin();
    this->_pixels->setBrightness(_cfg.neoPixelBright);
    
    this->setLed(0, 255, 0); // green = booting

    if (this->_cfg.screenEnabled) {
        Serial.println("Configure screen");
        Wire.begin(this->_cfg.OLED_SDA, this->_cfg.OLED_SCL);
        this->display = new Adafruit_SSD1306(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
        if (this->display->begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
            Serial.println("Configure screen next");
            this->display->setRotation(2);
            this->display->ssd1306_command(SSD1306_DISPLAYON);
            this->display->setTextColor(SSD1306_WHITE);
            this->display->setTextSize(1);
            this->display->clearDisplay();
            this->display->setCursor(0, 10);
            this->display->println("Salut");
            this->display->display();
        }
    }

    this->_setupWiFi();       // blocks until connected (or reboots)
    
    Serial.println("WIFI configured");
    Serial.printf("Current IP: %s\n", WiFi.localIP().toString().c_str());

    if (this->_allocateInferenceBuffer(EI_CLASSIFIER_RAW_SAMPLE_COUNT) == false) {
        ei_printf("ERR: Could not allocate audio buffer (size %d), this could be due to the window length of your model\r\n", EI_CLASSIFIER_RAW_SAMPLE_COUNT);
        return;
    }  

    this->_setupSpeakerI2S();
    if (this->_setupMicI2S(EI_CLASSIFIER_FREQUENCY)) {
        ei_printf("Failed to start I2S!");
    }

    setenv("TZ", "Europe/Paris", 1);
    tzset();

    configTime(7200, 0, "pool.ntp.org", "time.nist.gov", "time.google.com");

    this->setLed(0, 0, 255);
    
    xTaskCreatePinnedToCore( wsTask, "TaskWebSocket", 4096, NULL, 1, &this->taskWebSocketHandle, 0);
    delay(10000);
    xTaskCreatePinnedToCore( listenAndSendTask, "ListenAndSend", 1024 * 16, NULL, 10, &this->listenAndSendHandle, 1 );
    
    if (this->_cfg.screenEnabled) {
        xTaskCreate( displayStatusOnScreenTask, "ScreenDisplay", 4096, NULL, 1, &this->screenHandle );
    }
}