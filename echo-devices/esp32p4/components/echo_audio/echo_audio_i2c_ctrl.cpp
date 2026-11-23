/*
 * echo_audio_i2c_ctrl — a legacy-I2C audio_codec_ctrl_if_t for esp_codec_dev.
 *
 * The board wires the ES8311 to the same I2C port the JD9365 display driver
 * installs (I2C port 1, SDA=GPIO7 / SCL=GPIO8), and that driver uses the
 * *legacy* driver/i2c API (CONFIG_I2C_BUS_BACKWARD_CONFIG=y). A new i2c_master
 * bus handle cannot be created on a port a legacy driver owns, so esp_codec_dev's
 * default adapter (which needs one on IDF >= 5.3) cannot be used here. This file
 * provides the same audio_codec_ctrl_if_t contract on top of driver/i2c, exactly
 * like echo_display_touch.cpp / echo_sensor_paj7620.cpp do for their buses.
 *
 * esp_codec_dev 1.6.x requires a get_info() callback (used as the key of its
 * shared-codec reference manager), so it is implemented too.
 */
#include "echo_audio_ctrl_if.h"

#include "sdkconfig.h"

#if defined(CONFIG_ECHO_AUDIO_ENABLED)

#include <stdlib.h>
#include <string.h>

#include "driver/i2c.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"

#include "esp_codec_dev_defaults.h"

static const char *TAG = "echo_audio";

#define CTRL_I2C_TIMEOUT_MS 100

typedef struct {
    audio_codec_ctrl_if_t base;
    bool                  is_open;
    uint8_t               port;
    uint8_t               addr7;   /* 7-bit address used by the legacy helpers */
    uint8_t               addr8;   /* 8-bit address reported through get_info() */
} echo_i2c_ctrl_t;

static int ctrl_open(const audio_codec_ctrl_if_t *ctrl, void *cfg, int cfg_size)
{
    if (ctrl == NULL) {
        return ESP_CODEC_DEV_INVALID_ARG;
    }
    echo_i2c_ctrl_t *self = (echo_i2c_ctrl_t *)ctrl;
    /* The port/address were fixed at construction; the caller may still pass an
     * audio_codec_i2c_cfg_t, which is validated but otherwise ignored. */
    if (cfg != NULL && cfg_size != (int)sizeof(audio_codec_i2c_cfg_t)) {
        return ESP_CODEC_DEV_INVALID_ARG;
    }
    self->is_open = true;
    return ESP_CODEC_DEV_OK;
}

static bool ctrl_is_open(const audio_codec_ctrl_if_t *ctrl)
{
    return ctrl != NULL && ((const echo_i2c_ctrl_t *)ctrl)->is_open;
}

static int ctrl_read_reg(const audio_codec_ctrl_if_t *ctrl, int reg, int reg_len, void *data,
                         int data_len)
{
    if (ctrl == NULL || data == NULL || reg_len < 1 || reg_len > 2) {
        return ESP_CODEC_DEV_INVALID_ARG;
    }
    const echo_i2c_ctrl_t *self = (const echo_i2c_ctrl_t *)ctrl;
    if (!self->is_open) {
        return ESP_CODEC_DEV_WRONG_STATE;
    }

    uint8_t reg_bytes[2];
    reg_bytes[0] = (reg_len == 2) ? (uint8_t)(reg >> 8) : (uint8_t)(reg & 0xFF);
    if (reg_len == 2) {
        reg_bytes[1] = (uint8_t)(reg & 0xFF);
    }

    esp_err_t err = i2c_master_write_read_device((i2c_port_t)self->port, self->addr7, reg_bytes,
                                                 (size_t)reg_len, (uint8_t *)data,
                                                 (size_t)data_len,
                                                 pdMS_TO_TICKS(CTRL_I2C_TIMEOUT_MS));
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "I2C read reg 0x%02X from 0x%02X failed: %s", reg, self->addr7,
                 esp_err_to_name(err));
        return ESP_CODEC_DEV_READ_FAIL;
    }
    return ESP_CODEC_DEV_OK;
}

static int ctrl_write_reg(const audio_codec_ctrl_if_t *ctrl, int reg, int reg_len, void *data,
                          int data_len)
{
    if (ctrl == NULL || data == NULL || reg_len < 1 || reg_len > 2) {
        return ESP_CODEC_DEV_INVALID_ARG;
    }
    echo_i2c_ctrl_t *self = (echo_i2c_ctrl_t *)ctrl;
    if (!self->is_open) {
        return ESP_CODEC_DEV_WRONG_STATE;
    }
    if (reg_len + data_len > 4) {
        return ESP_CODEC_DEV_NOT_SUPPORT;
    }

    uint8_t buf[4];
    int i = 0;
    if (reg_len == 2) {
        buf[i++] = (uint8_t)(reg >> 8);
    }
    buf[i++] = (uint8_t)(reg & 0xFF);
    memcpy(&buf[i], data, (size_t)data_len);

    esp_err_t err = i2c_master_write_to_device((i2c_port_t)self->port, self->addr7, buf,
                                               (size_t)(reg_len + data_len),
                                               pdMS_TO_TICKS(CTRL_I2C_TIMEOUT_MS));
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "I2C write reg 0x%02X to 0x%02X failed: %s", reg, self->addr7,
                 esp_err_to_name(err));
        return ESP_CODEC_DEV_WRITE_FAIL;
    }
    return ESP_CODEC_DEV_OK;
}

static int ctrl_get_info(const audio_codec_ctrl_if_t *ctrl, audio_codec_ctrl_info_t *info)
{
    if (ctrl == NULL || info == NULL) {
        return ESP_CODEC_DEV_INVALID_ARG;
    }
    const echo_i2c_ctrl_t *self = (const echo_i2c_ctrl_t *)ctrl;
    info->type = AUDIO_CODEC_CTRL_I2C;
    info->i2c.addr = self->addr8;
    info->i2c.port = self->port;
    return ESP_CODEC_DEV_OK;
}

static int ctrl_close(const audio_codec_ctrl_if_t *ctrl)
{
    if (ctrl == NULL) {
        return ESP_CODEC_DEV_INVALID_ARG;
    }
    ((echo_i2c_ctrl_t *)ctrl)->is_open = false;
    return ESP_CODEC_DEV_OK;
}

const audio_codec_ctrl_if_t *echo_audio_i2c_ctrl_new(uint8_t port, uint8_t addr7)
{
    echo_i2c_ctrl_t *self = (echo_i2c_ctrl_t *)calloc(1, sizeof(echo_i2c_ctrl_t));
    if (self == NULL) {
        return NULL;
    }
    self->base.open = ctrl_open;
    self->base.is_open = ctrl_is_open;
    self->base.read_reg = ctrl_read_reg;
    self->base.write_reg = ctrl_write_reg;
    self->base.get_info = ctrl_get_info;
    self->base.close = ctrl_close;

    self->port = port;
    self->addr7 = addr7 & 0x7F;
    self->addr8 = (uint8_t)(self->addr7 << 1);
    self->is_open = true;
    return &self->base;
}

#endif /* CONFIG_ECHO_AUDIO_ENABLED */
