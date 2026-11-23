/*
 * Internal interface between the echo_display facade and the two panel drivers.
 * Not part of the public component API.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "esp_lcd_types.h"

#ifdef __cplusplus
extern "C" {
#endif

/* 10.1" Waveshare DSI panel (JD9365). */
esp_err_t echo_display_dsi_init(void);
bool      echo_display_dsi_ready(void);
esp_lcd_panel_handle_t echo_display_dsi_panel(void);
void     *echo_display_dsi_framebuffer(void);
esp_err_t echo_display_dsi_fill_rgb565(uint16_t rgb565);
esp_err_t echo_display_dsi_draw_rgb565(int x_start, int y_start, int x_end, int y_end,
                                       const uint16_t *pixels);

/* Touch input for the 10.1" DSI panel (GT911/GT9271 on the driver's I2C bus). */
esp_err_t echo_display_touch_init(void);
bool      echo_display_touch_ready(void);

/* 3.5" SPI TFT (ST7796 or ILI9488, chosen in Kconfig). */
esp_err_t echo_display_spi_init(void);
bool      echo_display_spi_ready(void);
esp_lcd_panel_handle_t echo_display_spi_panel(void);
esp_err_t echo_display_spi_fill_rgb565(uint16_t rgb565);
esp_err_t echo_display_spi_draw_rgb565(int x_start, int y_start, int x_end, int y_end,
                                       const uint16_t *pixels);

#ifdef __cplusplus
}
#endif
