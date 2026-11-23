/*
 * 10.1" Waveshare DSI panel — JD9365, 800x1280, RGB888, 2 lanes.
 *
 * Board wiring and DSI link settings mirror the proven PoC in src/main.cpp:
 *   * panel reset / backlight: Kconfig, default -1 ("not wired"), because the
 *     ESP32-P4-WIFI6 keeps LCD_RST and LCD_BL behind the I2C controller at 0x45
 *   * MIPI PHY LDO channel 3 @ 2.5 V
 *   * 2 lanes @ 1500 Mbps, DPI clock 80 MHz, RGB888, one framebuffer in PSRAM
 *
 * The Waveshare managed driver runs its own I2C power-on sequence on
 * I2C_NUM_1 (SDA=GPIO7, SCL=GPIO8, address 0x45) — no I2C init here. The same
 * sequence writes register 0x96 (backlight enable), so a discrete backlight GPIO
 * only exists on boards that have one.
 */
#include "echo_display_internal.h"

#include <string.h>

#include "driver/gpio.h"
#include "driver/i2c.h"
#include "esp_check.h"
#include "esp_lcd_jd9365_10_1.h"
#include "esp_lcd_mipi_dsi.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_ldo_regulator.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "sdkconfig.h"

static const char *TAG = "echo_display_dsi";

#define DSI_H_RES              800
#define DSI_V_RES              1280
#define DSI_PIN_RST            CONFIG_ECHO_DISPLAY_DSI_RESET_GPIO
#define DSI_PIN_BK_LIGHT       CONFIG_ECHO_DISPLAY_DSI_BL_GPIO
#define DSI_LDO_CHAN_ID        3
#define DSI_LDO_VOLTAGE_MV     2500
#define DSI_LANE_NUM           2
#define DSI_LANE_BIT_RATE_MBPS 1500
#define DSI_DPI_CLK_MHZ        80
#define DSI_BPP                24
#define DSI_BYTES_PER_PIXEL    3

static esp_ldo_channel_handle_t s_ldo;
static esp_lcd_dsi_bus_handle_t s_bus;
static esp_lcd_panel_io_handle_t s_io;
static esp_lcd_panel_handle_t s_panel;
static uint8_t *s_fb;
static bool s_ready;

static inline void fb_store(int x, int y, uint8_t r, uint8_t g, uint8_t b)
{
    if (x < 0 || x >= DSI_H_RES || y < 0 || y >= DSI_V_RES) {
        return;
    }
    size_t off = ((size_t)y * DSI_H_RES + (size_t)x) * DSI_BYTES_PER_PIXEL;
    /* The DSI host scans RGB888 out of this buffer as B, G, R bytes. */
    s_fb[off + 0] = b;
    s_fb[off + 1] = g;
    s_fb[off + 2] = r;
}

static inline void fb_store_rgb565(int x, int y, uint16_t c)
{
    /* 5/6-bit -> 8-bit by bit replication: exact 0xFF for white, no division. */
    uint8_t r = (uint8_t)((c >> 11) & 0x1F);
    uint8_t g = (uint8_t)((c >> 5) & 0x3F);
    uint8_t b = (uint8_t)(c & 0x1F);
    r = (uint8_t)((r << 3) | (r >> 2));
    g = (uint8_t)((g << 2) | (g >> 4));
    b = (uint8_t)((b << 3) | (b >> 2));
    fb_store(x, y, r, g, b);
}

/* The Waveshare driver writes register 0x96 on the I2C expander at 0x45 to switch
 * the backlight on, but ignores the transfer result. Re-assert it on the shared
 * legacy I2C_NUM_1 port (installed by the driver, also used by the touch
 * controller) and log the outcome, so a silent I2C failure cannot leave the panel
 * dark with no diagnostic. */
#if DSI_PIN_BK_LIGHT < 0
#define DSI_BL_I2C_PORT I2C_NUM_1
#define DSI_BL_I2C_ADDR 0x45
#define DSI_BL_I2C_REG  0x96

static void dsi_assert_backlight(void)
{
    const uint8_t payload[2] = { DSI_BL_I2C_REG, 0xFF };
    esp_err_t err = i2c_master_write_to_device(DSI_BL_I2C_PORT, DSI_BL_I2C_ADDR,
                                               payload, sizeof(payload),
                                               pdMS_TO_TICKS(100));
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "backlight re-asserted (I2C%d 0x%02X reg 0x%02X = 0xFF)",
                 DSI_BL_I2C_PORT, DSI_BL_I2C_ADDR, DSI_BL_I2C_REG);
    } else {
        ESP_LOGE(TAG, "backlight write failed: %s (I2C expander 0x%02X not answering?)",
                 esp_err_to_name(err), DSI_BL_I2C_ADDR);
    }
}
#endif

esp_err_t echo_display_dsi_init(void)
{
    if (s_ready) {
        return ESP_OK;
    }

#if DSI_PIN_BK_LIGHT >= 0
    /* Discrete backlight: stays off until the panel streams valid pixels. */
    const gpio_config_t bk_cfg = {
        .pin_bit_mask = 1ULL << DSI_PIN_BK_LIGHT,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&bk_cfg), TAG, "backlight GPIO");
    ESP_RETURN_ON_ERROR(gpio_set_level((gpio_num_t)DSI_PIN_BK_LIGHT, 0), TAG, "backlight off");
#endif

    /* MIPI DSI PHY supply. */
    const esp_ldo_channel_config_t ldo_cfg = {
        .chan_id = DSI_LDO_CHAN_ID,
        .voltage_mv = DSI_LDO_VOLTAGE_MV,
    };
    ESP_RETURN_ON_ERROR(esp_ldo_acquire_channel(&ldo_cfg, &s_ldo), TAG, "LDO channel");

    esp_lcd_dsi_bus_config_t bus_cfg = {};
    bus_cfg.bus_id = 0;
    bus_cfg.num_data_lanes = DSI_LANE_NUM;
    /* Rev >= 3.0 only accepts XTAL/APLL/CPLL/SPLL/MPLL; use the rev-3 default. */
    bus_cfg.phy_clk_src = MIPI_DSI_PHY_PLLREF_CLK_SRC_DEFAULT;
    bus_cfg.lane_bit_rate_mbps = DSI_LANE_BIT_RATE_MBPS;
    ESP_RETURN_ON_ERROR(esp_lcd_new_dsi_bus(&bus_cfg, &s_bus), TAG, "DSI bus");

    esp_lcd_dbi_io_config_t dbi_cfg = {};
    dbi_cfg.virtual_channel = 0;
    dbi_cfg.lcd_cmd_bits = 8;
    dbi_cfg.lcd_param_bits = 8;
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_dbi(s_bus, &dbi_cfg, &s_io), TAG, "DBI IO");

    esp_lcd_dpi_panel_config_t dpi_cfg = {};
    dpi_cfg.virtual_channel = 0;
    dpi_cfg.dpi_clk_src = MIPI_DSI_DPI_CLK_SRC_DEFAULT;
    dpi_cfg.dpi_clock_freq_mhz = DSI_DPI_CLK_MHZ;
    dpi_cfg.pixel_format = LCD_COLOR_PIXEL_FORMAT_RGB888;
    dpi_cfg.num_fbs = 1;
    dpi_cfg.video_timing.h_size = DSI_H_RES;
    dpi_cfg.video_timing.v_size = DSI_V_RES;
    dpi_cfg.video_timing.hsync_back_porch = 20;
    dpi_cfg.video_timing.hsync_pulse_width = 20;
    dpi_cfg.video_timing.hsync_front_porch = 40;
    dpi_cfg.video_timing.vsync_back_porch = 10;
    dpi_cfg.video_timing.vsync_pulse_width = 4;
    dpi_cfg.video_timing.vsync_front_porch = 30;
    dpi_cfg.flags.use_dma2d = true;

    jd9365_vendor_config_t vendor_cfg = {};
    vendor_cfg.init_cmds = NULL;      /* driver's built-in init table */
    vendor_cfg.init_cmds_size = 0;
    vendor_cfg.mipi_config.dsi_bus = s_bus;
    vendor_cfg.mipi_config.dpi_config = &dpi_cfg;
    vendor_cfg.mipi_config.lane_num = DSI_LANE_NUM;
    vendor_cfg.flags.use_mipi_interface = 1;

    esp_lcd_panel_dev_config_t panel_cfg = {};
    panel_cfg.reset_gpio_num = DSI_PIN_RST;
    panel_cfg.rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB;
    panel_cfg.bits_per_pixel = DSI_BPP;
    panel_cfg.vendor_config = &vendor_cfg;

    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_jd9365(s_io, &panel_cfg, &s_panel),
                        TAG, "create JD9365 panel");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_reset(s_panel), TAG, "panel reset");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_init(s_panel), TAG, "panel init");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_disp_on_off(s_panel, true), TAG, "display on");
#if DSI_PIN_BK_LIGHT >= 0
    ESP_RETURN_ON_ERROR(gpio_set_level((gpio_num_t)DSI_PIN_BK_LIGHT, 1), TAG, "backlight on");
#else
    dsi_assert_backlight();
#endif

    void *fb = NULL;
    ESP_RETURN_ON_ERROR(esp_lcd_dpi_panel_get_frame_buffer(s_panel, 1, &fb),
                        TAG, "get frame buffer");
    ESP_RETURN_ON_ERROR(esp_lcd_dpi_panel_set_pattern(s_panel, MIPI_DSI_PATTERN_NONE),
                        TAG, "clear test pattern");

    s_fb = (uint8_t *)fb;
    s_ready = true;
    ESP_LOGI(TAG, "JD9365 up: %dx%d RGB888, fb %p", DSI_H_RES, DSI_V_RES, (void *)s_fb);
#if DSI_PIN_BK_LIGHT >= 0
    ESP_LOGI(TAG, "backlight: GPIO%d (active high)", (int)DSI_PIN_BK_LIGHT);
#else
    ESP_LOGI(TAG, "backlight: none (I2C controller 0x45, register 0x96)");
#endif
#if DSI_PIN_RST >= 0
    ESP_LOGI(TAG, "reset: GPIO%d", (int)DSI_PIN_RST);
#else
    ESP_LOGI(TAG, "reset: none (handled by the I2C controller at 0x45)");
#endif
    return ESP_OK;
}

bool echo_display_dsi_ready(void)
{
    return s_ready;
}

esp_lcd_panel_handle_t echo_display_dsi_panel(void)
{
    return s_ready ? s_panel : NULL;
}

void *echo_display_dsi_framebuffer(void)
{
    return s_ready ? s_fb : NULL;
}

/* Flushing the whole framebuffer keeps the zero-copy fast path: the DPI driver
 * recognises its own buffer and only writes back the CPU cache. */
static esp_err_t dsi_flush_full(void)
{
    return esp_lcd_panel_draw_bitmap(s_panel, 0, 0, DSI_H_RES, DSI_V_RES, s_fb);
}

/* A pointer inside the DPI framebuffer makes the driver sync only the cache
 * lines covering y_start..y_end, so a sub-region flush costs O(rows). */
static esp_err_t dsi_flush_region(int x_start, int y_start, int x_end, int y_end)
{
    return esp_lcd_panel_draw_bitmap(s_panel, x_start, y_start, x_end, y_end, s_fb);
}

esp_err_t echo_display_dsi_fill_rgb565(uint16_t rgb565)
{
    if (!s_ready) {
        return ESP_ERR_INVALID_STATE;
    }
    for (int y = 0; y < DSI_V_RES; y++) {
        for (int x = 0; x < DSI_H_RES; x++) {
            fb_store_rgb565(x, y, rgb565);
        }
    }
    return dsi_flush_full();
}

esp_err_t echo_display_dsi_draw_rgb565(int x_start, int y_start, int x_end, int y_end,
                                       const uint16_t *pixels)
{
    if (!s_ready) {
        return ESP_ERR_INVALID_STATE;
    }
    if (pixels == NULL || x_start < 0 || y_start < 0 ||
        x_end > DSI_H_RES || y_end > DSI_V_RES ||
        x_start >= x_end || y_start >= y_end) {
        return ESP_ERR_INVALID_ARG;
    }

    const int width = x_end - x_start;
    for (int y = y_start; y < y_end; y++) {
        const uint16_t *row = pixels + (size_t)(y - y_start) * (size_t)width;
        for (int x = x_start; x < x_end; x++) {
            fb_store_rgb565(x, y, row[x - x_start]);
        }
    }
    return dsi_flush_region(x_start, y_start, x_end, y_end);
}
