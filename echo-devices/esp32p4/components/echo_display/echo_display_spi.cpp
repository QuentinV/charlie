/*
 * 3.5" SPI TFT — ILI9488 (RGB666) or ST7796 (RGB565), 480x320, SPI2_HOST.
 *
 * The two controllers share the MIPI-DCS command set used here (CASET, RASET,
 * RAMWR, MADCTL, COLMOD, DISPON), so one esp_lcd_panel_t implementation covers
 * both; Kconfig selects the pixel format and the power-on sequence:
 *
 *   ILI9488  COLMOD 0x66 (18-bit) -> every RGB565 pixel expands to 3 bytes.
 *   ST7796   COLMOD 0x55 (16-bit) -> RGB565 is sent as-is, 2 bytes big-endian.
 *
 * The ILI9488 does not reliably accept RGB565 in SPI mode, hence the split.
 * The driver implements esp_lcd_panel_t itself because ESP-IDF ships neither
 * driver; the handle can therefore be passed straight to LVGL's esp_lcd port.
 *
 * Wiring comes from Kconfig (menuconfig -> echo_display). Defaults match the
 * Waveshare ESP32-P4-WIFI6 40-pin header (CS 20, RST 21, DC 22, MOSI 23,
 * SCLK 26) and MUST be checked against the board schematic before flashing.
 */
#include "echo_display_internal.h"

#include <stdlib.h>
#include <string.h>

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_lcd_io_spi.h"
#include "esp_lcd_panel_interface.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "sdkconfig.h"

#ifdef CONFIG_ECHO_DISPLAY_SPI_ENABLED

static const char *TAG = "echo_display_spi";

#define SPI_H_RES       480
#define SPI_V_RES       320
#define SPI_HOST_AUX    SPI2_HOST

/* Controller selection: pixel format and power-on sequence differ. */
#if CONFIG_ECHO_DISPLAY_SPI_CTRL_ST7796
#define SPI_CTRL_NAME   "ST7796"
#define SPI_BYTES_PIXEL 2   /* RGB565 on the wire */
#define SPI_COLMOD      0x55
#else
#define SPI_CTRL_NAME   "ILI9488"
#define SPI_BYTES_PIXEL 3   /* RGB666 on the wire */
#define SPI_COLMOD      0x66
#endif

/* MIPI-DCS command set (shared subset used here). */
#define LCD_CMD_SWRESET     0x01
#define LCD_CMD_SLPOUT      0x11
#define LCD_CMD_DISPON      0x29
#define LCD_CMD_DISPOFF     0x28
#define LCD_CMD_CASET       0x2A
#define LCD_CMD_RASET       0x2B
#define LCD_CMD_RAMWR       0x2C
#define LCD_CMD_MADCTL      0x36
#define LCD_CMD_PIXFMT      0x3A

typedef struct {
    esp_lcd_panel_t base;
    esp_lcd_panel_io_handle_t io;
    int reset_gpio_num;
    bool mirror_x;
    bool mirror_y;
    bool swap_xy;
    bool invert;
    int x_gap;
    int y_gap;
    uint8_t madctl;
} spi_panel_t;

static spi_panel_t s_panel;
static SemaphoreHandle_t s_trans_done;
static bool s_ready;

static esp_err_t tx_cmd(uint8_t cmd, const uint8_t *params, size_t len)
{
    return esp_lcd_panel_io_tx_param(s_panel.io, cmd, params, len);
}

static esp_err_t set_window(int x0, int y0, int x1, int y1)
{
    /* Addresses are inclusive; callers pass exclusive ends. */
    const uint8_t caset[4] = {
        (uint8_t)(x0 >> 8), (uint8_t)(x0 & 0xFF),
        (uint8_t)((x1 - 1) >> 8), (uint8_t)((x1 - 1) & 0xFF),
    };
    const uint8_t raset[4] = {
        (uint8_t)(y0 >> 8), (uint8_t)(y0 & 0xFF),
        (uint8_t)((y1 - 1) >> 8), (uint8_t)((y1 - 1) & 0xFF),
    };
    ESP_RETURN_ON_ERROR(tx_cmd(LCD_CMD_CASET, caset, sizeof(caset)), TAG, "CASET");
    return tx_cmd(LCD_CMD_RASET, raset, sizeof(raset));
}

static esp_err_t wait_trans_done(TickType_t timeout)
{
    if (s_trans_done == NULL) {
        return ESP_OK;
    }
    return xSemaphoreTake(s_trans_done, timeout) == pdTRUE ? ESP_OK : ESP_ERR_TIMEOUT;
}

static bool on_color_done(esp_lcd_panel_io_handle_t io, esp_lcd_panel_io_event_data_t *edata,
                          void *user_ctx)
{
    (void)io;
    (void)edata;
    (void)user_ctx;
    BaseType_t woken = pdFALSE;
    if (s_trans_done != NULL) {
        xSemaphoreGiveFromISR(s_trans_done, &woken);
    }
    return woken == pdTRUE;
}

static esp_err_t panel_reset(esp_lcd_panel_t *panel)
{
    spi_panel_t *p = (spi_panel_t *)panel;
    if (p->reset_gpio_num < 0) {
        return ESP_OK;
    }
    ESP_RETURN_ON_ERROR(gpio_set_level((gpio_num_t)p->reset_gpio_num, 0), TAG, "RST low");
    vTaskDelay(pdMS_TO_TICKS(20));
    ESP_RETURN_ON_ERROR(gpio_set_level((gpio_num_t)p->reset_gpio_num, 1), TAG, "RST high");
    vTaskDelay(pdMS_TO_TICKS(120));
    return ESP_OK;
}

/* MADCTL bit layout: MY(7) MX(6) MV(5) ML(4) BGR(3) MH(2). */
static void update_madctl(void)
{
    uint8_t madctl = 0x08; /* BGR: these modules are wired BGR on the glass. */
    if (s_panel.swap_xy) {
        madctl |= 0x20;
    }
    if (s_panel.mirror_x) {
        madctl |= 0x40;
    }
    if (s_panel.mirror_y) {
        madctl |= 0x80;
    }
    s_panel.madctl = madctl;
}

#if CONFIG_ECHO_DISPLAY_SPI_CTRL_ST7796
/* ST7796S power-on sequence (Waveshare / LovyanGFX reference table). The
 * 0xF0 pages are unlock commands: 0xC3 -> 0x96 to enter the command set and
 * 0x3C -> 0x69 to leave it again. */
static esp_err_t st7796_init_sequence(void)
{
    static const uint8_t madctl_landscape = 0x28; /* MV | BGR */
    static const uint8_t dis_func[]  = {0x80, 0x02, 0x3B};
    static const uint8_t power_ctl[] = {0x40, 0x8A, 0x00, 0x00, 0x29, 0x19, 0xA5, 0x33};
    static const uint8_t gamma_pos[] = {
        0xF0, 0x09, 0x0B, 0x06, 0x04, 0x15, 0x2F, 0x54,
        0x42, 0x3C, 0x17, 0x14, 0x18, 0x1B,
    };
    static const uint8_t gamma_neg[] = {
        0xE0, 0x09, 0x0B, 0x06, 0x04, 0x03, 0x2B, 0x43,
        0x42, 0x3B, 0x16, 0x14, 0x17, 0x1B,
    };

    ESP_RETURN_ON_ERROR(tx_cmd(LCD_CMD_SWRESET, NULL, 0), TAG, "SWRESET");
    vTaskDelay(pdMS_TO_TICKS(120));

    ESP_RETURN_ON_ERROR(tx_cmd(0xF0, (const uint8_t[]){0xC3}, 1), TAG, "unlock C3");
    ESP_RETURN_ON_ERROR(tx_cmd(0xF0, (const uint8_t[]){0x96}, 1), TAG, "unlock 96");
    ESP_RETURN_ON_ERROR(tx_cmd(LCD_CMD_MADCTL, &madctl_landscape, 1), TAG, "MADCTL");
    ESP_RETURN_ON_ERROR(tx_cmd(LCD_CMD_PIXFMT, (const uint8_t[]){SPI_COLMOD}, 1),
                        TAG, "COLMOD 16-bit");
    ESP_RETURN_ON_ERROR(tx_cmd(0xB4, (const uint8_t[]){0x01}, 1), TAG, "INVCTRL");
    ESP_RETURN_ON_ERROR(tx_cmd(0xB6, dis_func, sizeof(dis_func)), TAG, "DFCTRL");
    ESP_RETURN_ON_ERROR(tx_cmd(0xE8, power_ctl, sizeof(power_ctl)), TAG, "PWCTRL");
    ESP_RETURN_ON_ERROR(tx_cmd(0xC1, (const uint8_t[]){0x06}, 1), TAG, "PWCTRL2");
    ESP_RETURN_ON_ERROR(tx_cmd(0xC2, (const uint8_t[]){0xA7}, 1), TAG, "PWCTRL3");
    ESP_RETURN_ON_ERROR(tx_cmd(0xC5, (const uint8_t[]){0x18}, 1), TAG, "VCOMCTRL");
    ESP_RETURN_ON_ERROR(tx_cmd(0xE0, gamma_pos, sizeof(gamma_pos)), TAG, "PGAMCTRL");
    ESP_RETURN_ON_ERROR(tx_cmd(0xE1, gamma_neg, sizeof(gamma_neg)), TAG, "NGAMCTRL");
    ESP_RETURN_ON_ERROR(tx_cmd(0xF0, (const uint8_t[]){0x3C}, 1), TAG, "lock 3C");
    ESP_RETURN_ON_ERROR(tx_cmd(0xF0, (const uint8_t[]){0x69}, 1), TAG, "lock 69");
    ESP_RETURN_ON_ERROR(tx_cmd(0x13, NULL, 0), TAG, "NORON"); /* normal display mode */
    vTaskDelay(pdMS_TO_TICKS(10));
    return ESP_OK;
}
#endif /* CONFIG_ECHO_DISPLAY_SPI_CTRL_ST7796 */

static esp_err_t panel_init(esp_lcd_panel_t *panel)
{
    (void)panel;

#if CONFIG_ECHO_DISPLAY_SPI_CTRL_ST7796
    ESP_RETURN_ON_ERROR(st7796_init_sequence(), TAG, "ST7796 init sequence");
#else
    static const uint8_t gamma_pos[] = {
        0x00, 0x03, 0x09, 0x08, 0x16, 0x0A, 0x3F, 0x78,
        0x4C, 0x09, 0x0A, 0x08, 0x16, 0x1A, 0x0F,
    };
    static const uint8_t gamma_neg[] = {
        0x00, 0x16, 0x19, 0x03, 0x0F, 0x05, 0x32, 0x45,
        0x46, 0x04, 0x0E, 0x0D, 0x35, 0x37, 0x0F,
    };
    static const uint8_t pw_ctrl[]  = {0x17, 0x15};
    static const uint8_t vcom_ctrl[] = {0x00, 0x12, 0x80};
    static const uint8_t interface[] = {0x02, 0x02};
    static const uint8_t enable_3g[] = {0xA9, 0x51, 0x2C, 0x82};

    ESP_RETURN_ON_ERROR(tx_cmd(LCD_CMD_SWRESET, NULL, 0), TAG, "SWRESET");
    vTaskDelay(pdMS_TO_TICKS(10));
    ESP_RETURN_ON_ERROR(tx_cmd(0xE0, gamma_pos, sizeof(gamma_pos)), TAG, "PGAMCTRL");
    ESP_RETURN_ON_ERROR(tx_cmd(0xE1, gamma_neg, sizeof(gamma_neg)), TAG, "NGAMCTRL");
    ESP_RETURN_ON_ERROR(tx_cmd(0xC0, pw_ctrl, sizeof(pw_ctrl)), TAG, "PWCTRL1");
    ESP_RETURN_ON_ERROR(tx_cmd(0xC1, (const uint8_t[]){0x41}, 1), TAG, "PWCTRL2");
    ESP_RETURN_ON_ERROR(tx_cmd(0xC5, vcom_ctrl, sizeof(vcom_ctrl)), TAG, "VCOMCTRL");
    ESP_RETURN_ON_ERROR(tx_cmd(LCD_CMD_PIXFMT, (const uint8_t[]){0x66}, 1), TAG, "COLMOD 18-bit");
    ESP_RETURN_ON_ERROR(tx_cmd(0xB0, (const uint8_t[]){0x00}, 1), TAG, "IFMODE");
    ESP_RETURN_ON_ERROR(tx_cmd(0xB1, (const uint8_t[]){0x00}, 1), TAG, "FRMCTRL1");
    ESP_RETURN_ON_ERROR(tx_cmd(0xB4, (const uint8_t[]){0x00}, 1), TAG, "INVCTRL");
    ESP_RETURN_ON_ERROR(tx_cmd(0xB6, interface, sizeof(interface)), TAG, "DFCTRL");
    ESP_RETURN_ON_ERROR(tx_cmd(0xE9, (const uint8_t[]){0x00}, 1), TAG, "ADJ3");
    ESP_RETURN_ON_ERROR(tx_cmd(0xF7, enable_3g, sizeof(enable_3g)), TAG, "ADJ3G");
#endif /* CONFIG_ECHO_DISPLAY_SPI_CTRL_ST7796 */

    /* Common tail: MADCTL comes from the panel state so mirror/swap keep working
     * on both controllers. */
    update_madctl();
    ESP_RETURN_ON_ERROR(tx_cmd(LCD_CMD_MADCTL, &s_panel.madctl, 1), TAG, "MADCTL");

    ESP_RETURN_ON_ERROR(tx_cmd(LCD_CMD_SLPOUT, NULL, 0), TAG, "SLPOUT");
    vTaskDelay(pdMS_TO_TICKS(120));
    ESP_RETURN_ON_ERROR(tx_cmd(LCD_CMD_DISPON, NULL, 0), TAG, "DISPON");
    vTaskDelay(pdMS_TO_TICKS(100));
    return ESP_OK;
}

static esp_err_t panel_del(esp_lcd_panel_t *panel)
{
    (void)panel;
    return ESP_OK;
}

static esp_err_t panel_draw_bitmap(esp_lcd_panel_t *panel, int x_start, int y_start,
                                   int x_end, int y_end, const void *color_data)
{
    (void)panel;
    return echo_display_spi_draw_rgb565(x_start, y_start, x_end, y_end,
                                        (const uint16_t *)color_data);
}

static esp_err_t panel_mirror(esp_lcd_panel_t *panel, bool mirror_x, bool mirror_y)
{
    spi_panel_t *p = (spi_panel_t *)panel;
    p->mirror_x = mirror_x;
    p->mirror_y = mirror_y;
    update_madctl();
    return tx_cmd(LCD_CMD_MADCTL, &p->madctl, 1);
}

static esp_err_t panel_swap_xy(esp_lcd_panel_t *panel, bool swap_xy)
{
    spi_panel_t *p = (spi_panel_t *)panel;
    p->swap_xy = swap_xy;
    update_madctl();
    return tx_cmd(LCD_CMD_MADCTL, &p->madctl, 1);
}

static esp_err_t panel_set_gap(esp_lcd_panel_t *panel, int x_gap, int y_gap)
{
    spi_panel_t *p = (spi_panel_t *)panel;
    p->x_gap = x_gap;
    p->y_gap = y_gap;
    return ESP_OK;
}

static esp_err_t panel_invert_color(esp_lcd_panel_t *panel, bool invert)
{
    spi_panel_t *p = (spi_panel_t *)panel;
    p->invert = invert;
    return tx_cmd(invert ? 0x21 : 0x20, NULL, 0); /* INVON / INVOFF */
}

static esp_err_t panel_disp_on_off(esp_lcd_panel_t *panel, bool on_off)
{
    (void)panel;
    return tx_cmd(on_off ? LCD_CMD_DISPON : LCD_CMD_DISPOFF, NULL, 0);
}

static esp_err_t panel_disp_sleep(esp_lcd_panel_t *panel, bool sleep)
{
    (void)panel;
    return tx_cmd(sleep ? 0x10 : LCD_CMD_SLPOUT, NULL, 0);
}

static esp_err_t panel_set_brightness(esp_lcd_panel_t *panel, int brightness)
{
    (void)panel;
    (void)brightness;
    /* Backlight is a plain GPIO on this module; PWM brightness is a later phase. */
    return ESP_ERR_NOT_SUPPORTED;
}

/* One display row in the controller wire format. Internal RAM so SPI DMA never touches PSRAM. */
#define SPI_LINE_BYTES (SPI_H_RES * SPI_BYTES_PIXEL)
static uint8_t s_line_buf[SPI_LINE_BYTES];

/* Serialise one RGB565 pixel into the line buffer in the controller's wire
 * format: RGB565 big-endian for ST7796, 18-bit RGB666 for the ILI9488. */
static inline void store_pixel(uint8_t *dst, uint16_t c)
{
#if SPI_BYTES_PIXEL == 2
    dst[0] = (uint8_t)(c >> 8);
    dst[1] = (uint8_t)(c & 0xFF);
#else
    const uint8_t r = (uint8_t)(((c >> 11) & 0x1F) * 255 / 31);
    const uint8_t g = (uint8_t)(((c >> 5) & 0x3F) * 255 / 63);
    const uint8_t b = (uint8_t)((c & 0x1F) * 255 / 31);
    dst[0] = r;
    dst[1] = g;
    dst[2] = b;
#endif
}

esp_err_t echo_display_spi_init(void)
{
    if (s_ready) {
        return ESP_OK;
    }

#if CONFIG_ECHO_DISPLAY_SPI_RST_GPIO >= 0
    const gpio_config_t rst_cfg = {
        .pin_bit_mask = 1ULL << CONFIG_ECHO_DISPLAY_SPI_RST_GPIO,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&rst_cfg), TAG, "reset GPIO");
#endif
#if CONFIG_ECHO_DISPLAY_SPI_BL_GPIO >= 0
    const gpio_config_t bl_cfg = {
        .pin_bit_mask = 1ULL << CONFIG_ECHO_DISPLAY_SPI_BL_GPIO,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&bl_cfg), TAG, "backlight GPIO");
    ESP_RETURN_ON_ERROR(gpio_set_level((gpio_num_t)CONFIG_ECHO_DISPLAY_SPI_BL_GPIO, 0),
                        TAG, "backlight off");
#endif

    spi_bus_config_t bus_cfg = {};
    bus_cfg.mosi_io_num = CONFIG_ECHO_DISPLAY_SPI_MOSI_GPIO;
    bus_cfg.miso_io_num = -1;
    bus_cfg.sclk_io_num = CONFIG_ECHO_DISPLAY_SPI_SCLK_GPIO;
    bus_cfg.quadwp_io_num = -1;
    bus_cfg.quadhd_io_num = -1;
    bus_cfg.max_transfer_sz = SPI_H_RES * SPI_V_RES * SPI_BYTES_PIXEL;
    ESP_RETURN_ON_ERROR(spi_bus_initialize(SPI_HOST_AUX, &bus_cfg, SPI_DMA_CH_AUTO),
                        TAG, "SPI bus");

    s_trans_done = xSemaphoreCreateBinary();
    ESP_RETURN_ON_FALSE(s_trans_done != NULL, ESP_ERR_NO_MEM, TAG, "semaphore");

    esp_lcd_panel_io_spi_config_t io_cfg = {};
    io_cfg.cs_gpio_num = CONFIG_ECHO_DISPLAY_SPI_CS_GPIO;
    io_cfg.dc_gpio_num = CONFIG_ECHO_DISPLAY_SPI_DC_GPIO;
    io_cfg.spi_mode = 0;
    io_cfg.pclk_hz = CONFIG_ECHO_DISPLAY_SPI_PCLK_HZ;
    io_cfg.trans_queue_depth = 4;
    io_cfg.lcd_cmd_bits = 8;
    io_cfg.lcd_param_bits = 8;
    io_cfg.on_color_trans_done = on_color_done;
    io_cfg.user_ctx = NULL;
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)SPI_HOST_AUX,
                                                 &io_cfg, &s_panel.io),
                        TAG, "panel IO");

    s_panel.base.reset = panel_reset;
    s_panel.base.init = panel_init;
    s_panel.base.del = panel_del;
    s_panel.base.draw_bitmap = panel_draw_bitmap;
    s_panel.base.mirror = panel_mirror;
    s_panel.base.swap_xy = panel_swap_xy;
    s_panel.base.set_gap = panel_set_gap;
    s_panel.base.invert_color = panel_invert_color;
    s_panel.base.disp_on_off = panel_disp_on_off;
    s_panel.base.disp_sleep = panel_disp_sleep;
    s_panel.base.set_brightness = panel_set_brightness;
    s_panel.base.user_data = &s_panel;
    s_panel.reset_gpio_num = CONFIG_ECHO_DISPLAY_SPI_RST_GPIO;
    /* The glass is 320x480 portrait; swap axes for the 480x320 landscape UI. */
    s_panel.swap_xy = true;

    ESP_RETURN_ON_ERROR(panel_reset(&s_panel.base), TAG, "panel reset");
    ESP_RETURN_ON_ERROR(panel_init(&s_panel.base), TAG, "panel init");
    ESP_RETURN_ON_ERROR(panel_disp_on_off(&s_panel.base, true), TAG, "display on");

#if CONFIG_ECHO_DISPLAY_SPI_BL_GPIO >= 0
    ESP_RETURN_ON_ERROR(gpio_set_level((gpio_num_t)CONFIG_ECHO_DISPLAY_SPI_BL_GPIO, 1),
                        TAG, "backlight on");
#endif

    s_ready = true;
    ESP_LOGI(TAG, "%s up: %dx%d, %d bytes/px, SPI clk %d Hz", SPI_CTRL_NAME, SPI_H_RES, SPI_V_RES, SPI_BYTES_PIXEL,
             (int)CONFIG_ECHO_DISPLAY_SPI_PCLK_HZ);
    return ESP_OK;
}

bool echo_display_spi_ready(void)
{
    return s_ready;
}

esp_lcd_panel_handle_t echo_display_spi_panel(void)
{
    return s_ready ? &s_panel.base : NULL;
}

static esp_err_t blit_rgb565(int x0, int y0, int x1, int y1, const uint16_t *pixels)
{
    if (!s_ready) {
        return ESP_ERR_INVALID_STATE;
    }
    if (pixels == NULL || x0 < 0 || y0 < 0 ||
        x1 > SPI_H_RES || y1 > SPI_V_RES ||
        x0 >= x1 || y0 >= y1) {
        return ESP_ERR_INVALID_ARG;
    }

    const int width = x1 - x0;
    const int height = y1 - y0;

    esp_err_t err = set_window(x0, y0, x1, y1);
    if (err == ESP_OK) {
        err = tx_cmd(LCD_CMD_RAMWR, NULL, 0);
    }
    if (err != ESP_OK) {
        return err;
    }

    /* Send one RGB666 row at a time from internal RAM, waiting for DMA between
     * rows so the shared line buffer can safely be rewritten. */
    for (int row = 0; row < height; row++) {
        const uint16_t *src = pixels + (size_t)row * (size_t)width;
        for (int i = 0; i < width; i++) {
            store_pixel(s_line_buf + (size_t)i * SPI_BYTES_PIXEL, src[i]);
        }
        err = esp_lcd_panel_io_tx_color(s_panel.io, -1, s_line_buf,
                                        (size_t)width * SPI_BYTES_PIXEL);
        if (err != ESP_OK) {
            return err;
        }
        err = wait_trans_done(pdMS_TO_TICKS(1000));
        if (err != ESP_OK) {
            return err;
        }
    }
    return ESP_OK;
}

esp_err_t echo_display_spi_fill_rgb565(uint16_t rgb565)
{
    if (!s_ready) {
        return ESP_ERR_INVALID_STATE;
    }

    for (int i = 0; i < SPI_H_RES; i++) {
        store_pixel(s_line_buf + (size_t)i * SPI_BYTES_PIXEL, rgb565);
    }

    esp_err_t err = set_window(0, 0, SPI_H_RES, SPI_V_RES);
    if (err == ESP_OK) {
        err = tx_cmd(LCD_CMD_RAMWR, NULL, 0);
    }
    if (err != ESP_OK) {
        return err;
    }

    for (int row = 0; row < SPI_V_RES; row++) {
        err = esp_lcd_panel_io_tx_color(s_panel.io, -1, s_line_buf,
                                        (size_t)SPI_LINE_BYTES);
        if (err != ESP_OK) {
            return err;
        }
        err = wait_trans_done(pdMS_TO_TICKS(1000));
        if (err != ESP_OK) {
            return err;
        }
    }
    return ESP_OK;
}

esp_err_t echo_display_spi_draw_rgb565(int x_start, int y_start, int x_end, int y_end,
                                       const uint16_t *pixels)
{
    return blit_rgb565(x_start, y_start, x_end, y_end, pixels);
}

#else /* !CONFIG_ECHO_DISPLAY_SPI_ENABLED */

esp_err_t echo_display_spi_init(void)            { return ESP_ERR_NOT_SUPPORTED; }
bool      echo_display_spi_ready(void)           { return false; }
esp_lcd_panel_handle_t echo_display_spi_panel(void) { return NULL; }
esp_err_t echo_display_spi_fill_rgb565(uint16_t rgb565) { (void)rgb565; return ESP_ERR_NOT_SUPPORTED; }
esp_err_t echo_display_spi_draw_rgb565(int x0, int y0, int x1, int y1, const uint16_t *pixels)
{
    (void)x0; (void)y0; (void)x1; (void)y1; (void)pixels;
    return ESP_ERR_NOT_SUPPORTED;
}

#endif /* CONFIG_ECHO_DISPLAY_SPI_ENABLED */


