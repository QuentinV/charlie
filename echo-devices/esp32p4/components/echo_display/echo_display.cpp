/*
 * echo_display facade — one entry point for both panels.
 *
 * Init order matters: bring the DSI panel up first (it carries the touch input
 * and the primary UI), then the SPI panel. A failure in one panel is logged and
 * the other still starts, so a mis-wired AUX panel cannot brick the device.
 */
#include "echo_display.h"

#include "echo_display_internal.h"
#include "esp_log.h"
#include "sdkconfig.h"

static const char *TAG = "echo_display";

/* Neutral boot colour: dark slate. Distinguishable from an unlit panel. */
#define ECHO_BOOT_COLOR_RGB565 0x18C3

esp_err_t echo_display_init(void)
{
    esp_err_t first_err = ESP_OK;
    esp_err_t err = ESP_OK;

#ifdef CONFIG_ECHO_DISPLAY_DSI_ENABLED
    err = echo_display_dsi_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "DSI panel failed: %s", esp_err_to_name(err));
        first_err = err;
    }
#endif

#ifdef CONFIG_ECHO_DISPLAY_SPI_ENABLED
    err = echo_display_spi_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "SPI panel failed: %s", esp_err_to_name(err));
        if (first_err == ESP_OK) {
            first_err = err;
        }
    }
#endif

    if (first_err == ESP_OK) {
        ESP_LOGI(TAG, "display stack ready");
    }
    return first_err;
}

bool echo_display_ready(echo_display_id_t id)
{
    switch (id) {
    case ECHO_DISPLAY_MAIN:
        return echo_display_dsi_ready();
    case ECHO_DISPLAY_AUX:
        return echo_display_spi_ready();
    default:
        return false;
    }
}

esp_lcd_panel_handle_t echo_display_panel(echo_display_id_t id)
{
    switch (id) {
    case ECHO_DISPLAY_MAIN:
        return echo_display_dsi_panel();
    case ECHO_DISPLAY_AUX:
        return echo_display_spi_panel();
    default:
        return NULL;
    }
}

void *echo_display_main_framebuffer(void)
{
    return echo_display_dsi_framebuffer();
}

esp_err_t echo_display_clear(echo_display_id_t id, uint16_t rgb565)
{
    switch (id) {
    case ECHO_DISPLAY_MAIN:
        return echo_display_dsi_fill_rgb565(rgb565);
    case ECHO_DISPLAY_AUX:
        return echo_display_spi_fill_rgb565(rgb565);
    default:
        return ESP_ERR_INVALID_ARG;
    }
}

esp_err_t echo_display_draw_rgb565(echo_display_id_t id, int x_start, int y_start,
                                   int x_end, int y_end, const uint16_t *pixels)
{
    switch (id) {
    case ECHO_DISPLAY_MAIN:
        return echo_display_dsi_draw_rgb565(x_start, y_start, x_end, y_end, pixels);
    case ECHO_DISPLAY_AUX:
        return echo_display_spi_draw_rgb565(x_start, y_start, x_end, y_end, pixels);
    default:
        return ESP_ERR_INVALID_ARG;
    }
}

esp_err_t echo_display_show_boot_screen(void)
{
    esp_err_t first_err = ESP_OK;

    if (echo_display_dsi_ready()) {
        esp_err_t err = echo_display_dsi_fill_rgb565(ECHO_BOOT_COLOR_RGB565);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "DSI boot screen failed: %s", esp_err_to_name(err));
            first_err = err;
        }
    }
    if (echo_display_spi_ready()) {
        esp_err_t err = echo_display_spi_fill_rgb565(ECHO_BOOT_COLOR_RGB565);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "SPI boot screen failed: %s", esp_err_to_name(err));
            if (first_err == ESP_OK) {
                first_err = err;
            }
        }
    }
    return first_err;
}
