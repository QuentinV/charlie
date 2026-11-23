/*
 * echo_audio codec bring-up: I2S std (full duplex) + ES8311 + NS4150B PA.
 *
 * Wiring (Waveshare ESP32-P4-WIFI6, "I2S Audio Demo"):
 *   MCLK  GPIO13   -> ES8311 master clock (driven by the ESP32-P4)
 *   SCLK  GPIO12   -> ES8311 BCLK
 *   LRCK  GPIO10   -> ES8311 WS
 *   DSDIN GPIO9    -> ES8311 DAC  (playback)
 *   ASDOUT GPIO11  -> ESP32-P4    (ES8311 ADC = microphone)
 *   PA    GPIO53   -> NS4150B enable, active high
 *
 * The codec is configured over I2C. The board wires it to the same bus the
 * JD9365 display driver installs (I2C port 1, SDA=GPIO7 / SCL=GPIO8) and that
 * driver uses the *legacy* driver/i2c API (CONFIG_I2C_BUS_BACKWARD_CONFIG=y).
 * esp_codec_dev's own I2C adapter needs a new i2c_master bus handle (IDF >= 5.3)
 * which cannot be created on a legacy port, so the control interface comes from
 * echo_audio_i2c_ctrl.cpp, which speaks driver/i2c.h on the shared port.
 *
 * The I2S data path always runs *stereo* 16-bit: esp_codec_dev's I2S data
 * interface rejects an odd channel count (see audio_codec_data_i2s.c). The ES8311
 * ADC is mono, so with no_dac_ref=true the microphone is on the left slot and the
 * right slot is empty; the facade keeps only the left sample.
 */
#include "echo_audio_internal.h"
#include "echo_audio_ctrl_if.h"

#include "sdkconfig.h"

#if defined(CONFIG_ECHO_AUDIO_ENABLED)

#include <string.h>

#include "driver/gpio.h"
#include "driver/i2s_std.h"
#include "esp_check.h"
#include "esp_log.h"

#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"

static const char *TAG = "echo_audio";

#define AUDIO_I2S_PORT    ((i2s_port_t)CONFIG_ECHO_AUDIO_I2S_PORT)
#define AUDIO_FS_BITS     16
#define AUDIO_FS_CHANNELS 2   /* esp_codec_dev requires an even channel count */

static i2s_chan_handle_t       s_tx;
static i2s_chan_handle_t       s_rx;
static esp_codec_dev_handle_t  s_dev;
static bool                    s_ready;
static bool                    s_open;
static uint32_t                s_open_rate;
static int                     s_volume = CONFIG_ECHO_AUDIO_SPEAKER_VOLUME;
static int                     s_mic_gain = CONFIG_ECHO_AUDIO_MIC_GAIN_DB;

esp_err_t echo_audio_platform_init(void)
{
    if (s_ready) {
        return ESP_OK;
    }

    /* One controller, two directions: TX and RX share the clocks. */
    i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(AUDIO_I2S_PORT, I2S_ROLE_MASTER);
    chan_cfg.auto_clear = true;   /* send silence instead of stale DMA data when idle */
    ESP_RETURN_ON_ERROR(i2s_new_channel(&chan_cfg, &s_tx, &s_rx), TAG, "i2s_new_channel");

    i2s_std_config_t std_cfg = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(CONFIG_ECHO_AUDIO_SAMPLE_RATE_HZ),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,
                                                        I2S_SLOT_MODE_STEREO),
        .gpio_cfg = {
            .mclk = (gpio_num_t)CONFIG_ECHO_AUDIO_MCLK_GPIO,
            .bclk = (gpio_num_t)CONFIG_ECHO_AUDIO_BCLK_GPIO,
            .ws   = (gpio_num_t)CONFIG_ECHO_AUDIO_WS_GPIO,
            .dout = (gpio_num_t)CONFIG_ECHO_AUDIO_DOUT_GPIO,
            .din  = (gpio_num_t)CONFIG_ECHO_AUDIO_DIN_GPIO,
            .invert_flags = { 0 },
        },
    };
    /* MCLK = 256 x fs: 4.096 MHz at 16 kHz and 5.6448 MHz at 22050 Hz, both in
     * the ES8311 clock-coefficient table. */
    std_cfg.clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256;
    ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(s_tx, &std_cfg), TAG, "i2s tx std mode");
    ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(s_rx, &std_cfg), TAG, "i2s rx std mode");

    /* Amplifier enable. Driven here (not by esp_codec_dev) so it is only raised
     * while playback is running: an idle amplifier would hiss continuously. */
#if CONFIG_ECHO_AUDIO_PA_GPIO >= 0
    gpio_config_t pa_cfg = {
        .pin_bit_mask = 1ULL << CONFIG_ECHO_AUDIO_PA_GPIO,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&pa_cfg), TAG, "PA GPIO");
    gpio_set_level((gpio_num_t)CONFIG_ECHO_AUDIO_PA_GPIO, 0);
#endif

    /* Codec control over the display's legacy I2C port. */
    const audio_codec_ctrl_if_t *ctrl_if =
        echo_audio_i2c_ctrl_new((uint8_t)CONFIG_ECHO_AUDIO_I2C_PORT,
                                (uint8_t)CONFIG_ECHO_AUDIO_I2C_ADDR);
    if (ctrl_if == NULL) {
        ESP_LOGE(TAG, "ES8311 control init failed on I2C port %d (is the display up?)",
                 CONFIG_ECHO_AUDIO_I2C_PORT);
        return ESP_ERR_NOT_FOUND;
    }

    es8311_codec_cfg_t es_cfg = {
        .ctrl_if = ctrl_if,
        .gpio_if = audio_codec_new_gpio(),
        .codec_mode = ESP_CODEC_DEV_WORK_MODE_BOTH,
        .pa_pin = -1,             /* PA_CTRL is owned by echo_audio */
        .pa_reverted = false,
        .master_mode = false,     /* the ESP32-P4 is the I2S master */
        .use_mclk = true,
        .digital_mic = false,
        .invert_mclk = false,
        .invert_sclk = false,
        .no_dac_ref = true,       /* left slot = microphone, right slot empty */
        .mclk_div = 256,
    };
    const audio_codec_if_t *codec_if = es8311_codec_new(&es_cfg);
    if (codec_if == NULL) {
        ESP_LOGE(TAG, "ES8311 init failed (no ACK at 0x%02X)", CONFIG_ECHO_AUDIO_I2C_ADDR);
        return ESP_ERR_NOT_FOUND;
    }

    audio_codec_i2s_cfg_t i2s_data_cfg = {
        .port = (uint8_t)CONFIG_ECHO_AUDIO_I2S_PORT,
        .rx_handle = s_rx,
        .tx_handle = s_tx,
    };
    const audio_codec_data_if_t *data_if = audio_codec_new_i2s_data(&i2s_data_cfg);
    if (data_if == NULL) {
        ESP_LOGE(TAG, "I2S data interface init failed");
        return ESP_ERR_NO_MEM;
    }

    esp_codec_dev_cfg_t dev_cfg = {
        .dev_type = ESP_CODEC_DEV_TYPE_IN_OUT,
        .codec_if = codec_if,
        .data_if = data_if,
    };
    s_dev = esp_codec_dev_new(&dev_cfg);
    if (s_dev == NULL) {
        ESP_LOGE(TAG, "codec device init failed");
        return ESP_ERR_NO_MEM;
    }

    s_ready = true;
    ESP_LOGI(TAG, "ES8311 ready: i2s%d mclk=%d bclk=%d ws=%d din=%d dout=%d i2c%d pa=%d",
             CONFIG_ECHO_AUDIO_I2S_PORT, CONFIG_ECHO_AUDIO_MCLK_GPIO,
             CONFIG_ECHO_AUDIO_BCLK_GPIO, CONFIG_ECHO_AUDIO_WS_GPIO,
             CONFIG_ECHO_AUDIO_DIN_GPIO, CONFIG_ECHO_AUDIO_DOUT_GPIO,
             CONFIG_ECHO_AUDIO_I2C_PORT, CONFIG_ECHO_AUDIO_PA_GPIO);
    return ESP_OK;
}

bool echo_audio_platform_ready(void)
{
    return s_ready;
}

esp_err_t echo_audio_platform_open(uint32_t sample_rate_hz)
{
    if (!s_ready) {
        return ESP_ERR_INVALID_STATE;
    }
    if (s_open && s_open_rate == sample_rate_hz) {
        return ESP_OK;
    }
    if (s_open) {
        esp_codec_dev_close(s_dev);
        s_open = false;
        s_open_rate = 0;
    }

    esp_codec_dev_sample_info_t fs = {
        .bits_per_sample = AUDIO_FS_BITS,
        .channel = AUDIO_FS_CHANNELS,
        .sample_rate = sample_rate_hz,
        .mclk_multiple = 256,
    };
    int ret = esp_codec_dev_open(s_dev, &fs);
    if (ret != ESP_CODEC_DEV_OK) {
        ESP_LOGE(TAG, "codec open at %u Hz failed: %d", (unsigned)sample_rate_hz, ret);
        return ESP_FAIL;
    }
    esp_codec_dev_set_out_vol(s_dev, s_volume);
    esp_codec_dev_set_in_gain(s_dev, s_mic_gain);
    s_open = true;
    s_open_rate = sample_rate_hz;
    return ESP_OK;
}

esp_err_t echo_audio_platform_close(void)
{
    if (s_open) {
        esp_codec_dev_close(s_dev);
        s_open = false;
        s_open_rate = 0;
    }
    return ESP_OK;
}

esp_err_t echo_audio_platform_read(int16_t *stereo, size_t frames)
{
    if (!s_ready || !s_open) {
        return ESP_ERR_INVALID_STATE;
    }
    int len = (int)(frames * AUDIO_FS_CHANNELS * sizeof(int16_t));
    return esp_codec_dev_read(s_dev, stereo, len) == ESP_CODEC_DEV_OK ? ESP_OK : ESP_FAIL;
}

esp_err_t echo_audio_platform_write(const int16_t *stereo, size_t frames)
{
    if (!s_ready || !s_open) {
        return ESP_ERR_INVALID_STATE;
    }
    int len = (int)(frames * AUDIO_FS_CHANNELS * sizeof(int16_t));
    /* esp_codec_dev_write takes a non-const pointer but only reads it. */
    return esp_codec_dev_write(s_dev, (void *)stereo, len) == ESP_CODEC_DEV_OK ? ESP_OK : ESP_FAIL;
}

void echo_audio_platform_set_volume(int volume_0_100)
{
    if (volume_0_100 < 0) volume_0_100 = 0;
    if (volume_0_100 > 100) volume_0_100 = 100;
    s_volume = volume_0_100;
    if (s_open) {
        esp_codec_dev_set_out_vol(s_dev, s_volume);
    }
}

void echo_audio_platform_set_mic_gain(int db)
{
    if (db < 0) db = 0;
    s_mic_gain = db;
    if (s_open) {
        esp_codec_dev_set_in_gain(s_dev, s_mic_gain);
    }
}

void echo_audio_platform_pa(bool on)
{
#if CONFIG_ECHO_AUDIO_PA_GPIO >= 0
    gpio_set_level((gpio_num_t)CONFIG_ECHO_AUDIO_PA_GPIO, on ? 1 : 0);
#else
    (void)on;
#endif
}

#else /* !CONFIG_ECHO_AUDIO_ENABLED */

esp_err_t echo_audio_platform_init(void)   { return ESP_ERR_INVALID_STATE; }
bool      echo_audio_platform_ready(void)  { return false; }
esp_err_t echo_audio_platform_open(uint32_t sample_rate_hz) { (void)sample_rate_hz; return ESP_ERR_INVALID_STATE; }
esp_err_t echo_audio_platform_close(void)  { return ESP_OK; }
esp_err_t echo_audio_platform_read(int16_t *stereo, size_t frames) { (void)stereo; (void)frames; return ESP_ERR_INVALID_STATE; }
esp_err_t echo_audio_platform_write(const int16_t *stereo, size_t frames) { (void)stereo; (void)frames; return ESP_ERR_INVALID_STATE; }
void      echo_audio_platform_set_volume(int volume_0_100) { (void)volume_0_100; }
void      echo_audio_platform_set_mic_gain(int db) { (void)db; }
void      echo_audio_platform_pa(bool on) { (void)on; }

#endif /* CONFIG_ECHO_AUDIO_ENABLED */
