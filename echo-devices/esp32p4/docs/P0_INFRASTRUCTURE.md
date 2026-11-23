# Echo-Cook P0 — infrastructure status

This phase replaces the display-only "smiley" proof of concept with the
component layout the product work will build on. It covers boot plumbing plus the
first real UI: an LVGL recipe screen on both panels, fed by the UTF-8 files in
the storage partition. Audio and network are still deliberately absent.

## Hardware map

| Role | Panel | Resolution | Interface | Touch |
| --- | --- | --- | --- | --- |
| Main | Waveshare 10.1" DSI (JD9365) | 800 x 1280 | MIPI DSI, 2 lanes, RGB888 | Yes — GT911/GT9271 on I2C |
| Aux | 3.5" TFT (ST7796S) | 480 x 320 | SPI2, RGB565 | No |
| Sensor | DHT22 temperature/humidity | — | 1-wire bit-banged on GPIO5 | — |
| Sensor | PAJ7620U2 air gestures | — | I2C (display bus), INT on GPIO4 | — |
| Audio | ES8311 codec + NS4150B amp (onboard mic + speaker) | — | I2S0 full-duplex + I2C (display bus) + `PA_CTRL` GPIO53 | — |

Design notes:

* Both panels accept drawing through one facade (`echo_display.h`) that takes
  RGB565 rectangles and converts to the panel-native format internally.
* The JD9365 driver (managed component `waveshare/esp_lcd_jd9365_10_1`) installs
  its own I2C master on **I2C_NUM_1, SDA=GPIO7, SCL=GPIO8, 100 kHz** during
  power-on and never releases it. The touch driver therefore reuses that port
  instead of installing a second one.
* The driver reaches I2C through `espressif/i2c_bus`. On IDF >= 5.3 that
  component defaults to the new `i2c_master` API and keeps its bus handle
  private, so the panel's port would be unusable from `echo_display_touch`.
  `CONFIG_I2C_BUS_BACKWARD_CONFIG=y` (see `sdkconfig.defaults` and
  `sdkconfig.esp32-p4-evboard`) makes it install the legacy `driver/i2c` port
  instead, which the touch driver shares. Do not remove that flag unless the
  touch driver is rewritten for the new API.
* The 3.5" SPI panel is driven by a self-contained `esp_lcd_panel_t`
  implementation. Kconfig selects the controller, because the two candidates
  need different pixel formats: **ST7796** (default, the AliExpress module on
  this build) sends native RGB565 (`0x3A = 0x55`, 2 bytes/pixel), while
  **ILI9488** must be driven in 18-bit RGB666 (`0x3A = 0x66`, 3 bytes/pixel)
  because RGB565 is unreliable on it over SPI. A wrong choice shows up as a
  colour-shifted or garbled panel, not as a boot failure.
* The DSI panel has **no reset and no backlight GPIO** on this board: both live
  behind the I2C controller at address 0x45 (backlight on register 0x96), which
  the Waveshare driver drives itself. `CONFIG_ECHO_DISPLAY_DSI_RESET_GPIO` and
  `_BL_GPIO` therefore default to `-1` and the driver's GPIO calls compile out.
  An earlier revision hard-coded GPIO27/26 here; that stole the SPI panel's
  SCLK line, so keep both at `-1` unless the carrier changes.

## GPIO map

Pin numbers come from the Waveshare ESP32-P4-WIFI6 schematic and the panel's
wiring; everything is also expressed in Kconfig, so this table is the reference
and `menuconfig` is the source of truth.

| GPIO | Function | Owner |
| --- | --- | --- |
| 4 | PAJ7620U2 `INT` (active low, optional) | `echo_sensors` |
| 5 | DHT22 data (4.7k-10k pull-up to 3V3) | `echo_sensors` |
| 7 | I2C SDA — **shared** bus (touch, gesture, BL controller 0x45) | installed by the JD9365 driver |
| 8 | I2C SCL — **shared** bus | installed by the JD9365 driver |
| 9 | I2S `DSDIN` — ESP32-P4 → ES8311 DAC (playback) | `echo_audio` |
| 10 | I2S `LRCK`/WS to the ES8311 | `echo_audio` |
| 11 | I2S `ASDOUT` — ES8311 ADC → ESP32-P4 (microphone) | `echo_audio` |
| 12 | I2S `SCLK`/BCLK to the ES8311 | `echo_audio` |
| 13 | I2S `MCLK` to the ES8311 (4.096 MHz @16 kHz, 5.6448 MHz @22.05 kHz) | `echo_audio` |
| 14-19 | SDIO to the ESP32-C6 (`CLK`, `CMD`, `D0..D3`) | `esp_hosted` |
| 20 | 3.5" panel `CS` | `echo_display` |
| 21 | 3.5" panel `RESET` | `echo_display` |
| 22 | 3.5" panel `D/C` | `echo_display` |
| 23 | 3.5" panel `MOSI` | `echo_display` |
| 26 | 3.5" panel `SCLK` | `echo_display` |
| 37 / 38 | UART0 console | bootloader |
| 39-45 | TF card slot | reserved for storage |
| 53 | NS4150B `PA_CTRL` (active high) | `echo_audio` |
| 54 | ESP32-C6 reset (`EN`) | `esp_hosted` |

Rules that follow from the table:

* **Never install a second I2C driver.** Port 1 (SDA 7 / SCL 8) is owned by the
  Waveshare JD9365 driver, which never releases it. Touch and the gesture sensor
  both issue transfers on that port; a second `i2c_driver_install()` fails.
  Keep the sensor address distinct from 0x45 (backlight), 0x5D/0x14 (touch) and
  0x18 — PAJ7620U2 uses 0x73.
* **GPIO 26 belongs to the SPI panel.** Nothing else may touch it, which is why
  the DSI backlight is I2C-only.
* GPIO 4 and 5 are free and are the only pins the sensor layer claims.

## Boot order (`src/main.cpp`)

1. `echo_event_bus_init()` — default ESP-IDF event loop.
2. `echo_storage_init()` — NVS + SPIFFS mount (`/storage`), plus UTF-8 demo
   recipes (`recipes/welcome.txt`, `recipes/gratin_dauphinois.txt`) written on
   first boot only (see `kSeedRecipes` in `src/main.cpp`).
3. `echo_display_init()` — DSI first, then SPI; a failure of one panel does not
   stop the other.
4. `echo_display_show_boot_screen()` — solid slate fill on every ready panel.
5. `echo_display_touch_init()` — only when the DSI panel is up.
6. `echo_ui_init()` — LVGL displays, recipe screens, touch indev and UI task.
7. `echo_wifi_connect()` — hosted station start; then a bounded 5 s wait so the
   log reports `online`/`pending`. Both calls return immediately.
8. `echo_ha_start()` — Charlie server WebSocket client (retries in background;
   a missing server address is not an error).
9. `echo_sensors_init()` — DHT22 + PAJ7620U2. Must come after step 3: the
   gesture sensor shares the I2C port the DSI driver installed.
10. `echo_wakeword_init()` (the engine is attached only when the `model`
    partition exists) + `echo_audio_init()/start()` + `echo_voice_init()`. Audio
    also reuses the display's I2C port, so it comes after step 3. The voice loop
    is what feeds 16 kHz mono PCM to the wake word and, on a detection, uploads
    one utterance to Charlie and plays the reply.
11. `ECHO_EVT_BOOT_READY` is posted on the bus.

Every failure is posted as `ECHO_EVT_ERROR` with a component tag, so later
services can react without checking return codes at boot.

## Components

| Component | Contents |
| --- | --- |
| `echo_core` | `echo_events.h` (event ids, payloads), `echo_event_bus.cpp`, `echo_storage.{h,cpp}` (NVS, SPIFFS, UTF-8 file helpers). |
| `echo_display` | `echo_display.{h,cpp}` facade, `echo_display_dsi.cpp` (JD9365), `echo_display_spi.cpp` (ST7796/ILI9488), `echo_display_touch.cpp` (GT911/GT9271 gestures + raw samples). |
| `echo_sensors` | `echo_sensors.{h,cpp}` facade, `echo_sensor_dht22.cpp` (bit-banged temperature/humidity), `echo_sensor_paj7620.cpp` (air gestures over the display's I2C bus). Publishes `ECHO_EVT_TEMPERATURE` and `ECHO_EVT_AIR_GESTURE`. |
| `echo_ui` | LVGL 9 port (`echo_ui.cpp`), DejaVu-based Latin-1 fonts, main/aux screens, recipe list → detail flow. |
| `echo_wakeword` | Existing "Hey Charlie" policy layer and optional TFLite engine. |
| `echo_wifi` | Hosted Wi-Fi station (`echo_wifi.{h,cpp}`): netif + `esp_wifi` on top of `esp_wifi_remote`/`esp_hosted`, reconnect timer, `ECHO_EVT_NET_STATUS` publisher. |
| `echo_ha` | Charlie server client (`echo_ha.{h,cpp}`, `echo_ha_protocol.h`): WebSocket to `ws://<server>:9303/ws/echo`, JSON commands → events, utterance upload, `versions`/MAC handshake. |
| `echo_audio` | Onboard audio path: `echo_audio.{h,cpp}` facade + capture/playback tasks, `echo_audio_codec.cpp` (I2S0 std full-duplex + ES8311 + NS4150B PA), `echo_audio_i2c_ctrl.cpp` (legacy-I²C codec control). |
| `echo_voice` | Conversation loop (`echo_voice.{h,cpp}`): microphone → `echo_wakeword` → `echo_ha` upload, plus TTS playback and detection suppression on its own task. Publishes `ECHO_EVT_WAKE_WORD`. |

### Event bus

All cross-component traffic uses `ECHO_EVENT` on the default event loop:

| Event | Payload |
| --- | --- |
| `ECHO_EVT_BOOT_READY` | none |
| `ECHO_EVT_WAKE_WORD` | `echo_wake_word_t` |
| `ECHO_EVT_GESTURE` | `echo_gesture_t` (tap / swipe on `ECHO_SCREEN_MAIN`) |
| `ECHO_EVT_UI_NAVIGATE` | `echo_ui_cmd_t` |
| `ECHO_EVT_RECIPE_SELECTED` / `_LOADED` | path / UTF-8 text |
| `ECHO_EVT_NET_STATUS` | `echo_net_status_t` |
| `ECHO_EVT_HA_STATUS` | `echo_ha_status_t` (WebSocket up/down) |
| `ECHO_EVT_HA_TTS_START` / `_TTS_END` | none / `echo_ha_tts_t` (`follow_up`) |
| `ECHO_EVT_HA_TEXT` | `echo_ha_text_t` (`feedback`, `updateDisplays`) |
| `ECHO_EVT_HA_WAKE_ACCURACY` | `echo_ha_accuracy_t` (per mille) |
| `ECHO_EVT_ERROR` | `echo_error_t` |

Handlers run on the event-loop task and must not block.

### Storage

`partitions.csv` (project root, 16 MB flash):

| Partition | Offset | Size | Purpose |
| --- | --- | --- | --- |
| `nvs` | `0x9000` | 24 KB | settings, future Wi-Fi credentials |
| `phy_init` | `0xF000` | 4 KB | reserved |
| `factory` | `0x10000` | 8.94 MB | application (stock ESP-IDF app offset) |
| `model` | `0x900000` | 1 MB | TFLite wake-word model, memory-mapped by the engine |
| `storage` | `0xA00000` | 6 MB | SPIFFS, UTF-8 recipes and LVGL assets |

The app **must** start at `0x10000`. That offset is what the bootloader, esptool,
ESP-IDF's `flasher_args.json` and PlatformIO's merged `firmware.factory.bin`
assume for the app; with the app anywhere else the merged image writes it at
`0x10000` anyway, the `factory` slot stays erased and the board boot-loops
(`invalid magic byte`, `Factory app partition is not bootable`). `model` and
`storage` are looked up by name (`esp_partition_find_first`, `echo_storage_mount`),
so their offsets can move without touching code.

`echo_storage_*` treats recipe bytes as opaque UTF-8: it never transcodes, so
strings reach the renderer exactly as authored. File writes go through a
`.tmp` + rename so a power cut cannot truncate a recipe.

## LVGL UI (`echo_ui`)

`echo_ui` owns the only LVGL instance; both panels are displays of that instance.

| LVGL role | Panel | Size | Render buffer | Input |
| --- | --- | --- | --- | --- |
| default | MAIN DSI (JD9365) | 800 x 1280 | 800 x 80 RGB565 in PSRAM (128 KB) | GT911 pointer indev |
| secondary | AUX SPI (ST7796) | 480 x 320 | 480 x 40 RGB565 in internal RAM (38 KB) | none |

Design notes:

* LVGL 9 is built with `LV_OS_NONE`. `echo_ui` serialises every LVGL call with
  its own mutex from a single UI task (`lv_timer_handler`); other tasks send
  small commands through a FreeRTOS queue, so the event loop never blocks on
  rendering.
* Flush path: LVGL `flush_cb` → `echo_display_draw_rgb565()` for that display's
  `echo_display_id_t`. The DSI driver converts only the flushed rectangle and
  re-syncs only those rows — the IDF DPI driver does a cache write-back when the
  pointer is inside its framebuffer, which keeps partial redraws O(area) instead
  of O(screen). The AUX driver serialises one row at a time through a 1.4 KB
  line buffer: native RGB565 on the ST7796, expanded to RGB666 on the ILI9488.
* Touch: classified gestures stay on the event bus for app logic, while LVGL
  reads raw press/move/release through `echo_display_touch_read()` so scrolling
  and button presses work. Kconfig options `ECHO_DISPLAY_TOUCH_SWAP_XY`,
  `ECHO_DISPLAY_TOUCH_MIRROR_X` and `ECHO_DISPLAY_TOUCH_MIRROR_Y` correct panel
  batches whose controller is mounted rotated.
* Fonts: generated from LVGL's bundled `DejaVuSans.ttf` at 16/20/28 px, covering
  Latin-1 so French accents in the recipes render. Regeneration command and
  license note are in `components/echo_ui/fonts/README.md`.
* Screens: MAIN has a header (brand + position), recipe title, scrollable UTF-8
  body and a footer (`<`, `Recettes`, `>`, `Réglages`). The picker scans
  `/storage/recipes/*.txt` and sorts by name. AUX mirrors the current recipe in a
  compact layout. `echo_ui_show_recipe()` and `echo_ui_show_recipe_list()` let
  other services drive navigation.
* Config: `CONFIG_LV_COLOR_FORMAT_RGB565=y` (both panels consume RGB565 blits)
  and `CONFIG_LV_MEM_SIZE=131072`.

## Boot status screen (`echo_status`)

A one-shot diagnostics page for bring-up. `echo_status_init()` (called last from
`app_main`) starts a task that waits `ECHO_STATUS_DELAY_MS` (5 s), paints a
label/value list on the 10.1" panel and "Welcome to EchoCook" on the 3.5"
(`ECHO_STATUS_SHOW_AUX`), plays a two-note 660/990 Hz chime through
`echo_audio_play_tone()` (`ECHO_STATUS_PLAY_SOUND`) and refreshes the values about
once a second for `ECHO_STATUS_WINDOW_MS` (15 s).

The rows come only from public getters, so no other component changes:

| Row | Source |
| --- | --- |
| Uptime | `esp_timer_get_time()` |
| RAM free / low-water | `heap_caps_get_*_size(MALLOC_CAP_INTERNAL)` |
| PSRAM free | `heap_caps_get_*_size(MALLOC_CAP_SPIRAM)` |
| Wi-Fi | `echo_wifi_is_connected/get_ip/rssi/ssid/retry_count` |
| Time | `echo_wifi_time_str()` (SNTP; see `### echo_wifi`) |
| Panel 10.1" / Touch | `echo_display_ready(MAIN)`, `echo_display_touch_ready()` |
| Panel 3.5" | `echo_display_ready(AUX)` |
| Temperature | `echo_sensors_temperature_last()` |
| Gesture | `echo_sensors_gesture_ready()` |
| Microphone / Speaker | `echo_audio_is_ready()` |
| Wake word / Charlie | `echo_wakeword_is_ready()`, `echo_ha_is_connected()` |

Every subsystem that is compiled out (or has no driver) degrades to a "disabled"
row, so the page is a genuine bring-up checklist.

It is a *sibling* of `echo_screen`, not a second UI owner: it never creates a
display or a task of its own beyond the one shot, and every LVGL call happens
under `echo_ui`'s lock, reusing `echo_ui`'s Latin-1 fonts. On exit it restores
the screens that were visible before — guarded by `echo_screen_rev()`, so a
Charlie bundle that installed a page during the window simply wins and the
status widgets are deleted.

## Wi-Fi and the Charlie server (`echo_wifi`, `echo_ha`)

### `echo_wifi`

Plain ESP-IDF station code (`esp_netif_init` → `esp_netif_create_default_wifi_sta`
→ `esp_wifi_init/set_mode/set_config/start`). The hosted trick is transparent: it
`REQUIRES esp_wifi`, and `esp_wifi_remote` prepends its *injected* include
directory to that component, so `#include "esp_wifi.h"` resolves to the
slave-capable header set and the `esp_wifi_*` calls are routed to `esp_hosted`.
Because `CONFIG_ESP_WIFI_ENABLED` is not set, `WIFI_REMOTE_EVENT` is an alias of
`WIFI_EVENT`, which is why the usual `WIFI_EVENT`/`IP_EVENT` handlers work.

| Kconfig | Default | Note |
| --- | --- | --- |
| `ECHO_WIFI_ENABLED` | `y` | disable for display-only bring-up |
| `ECHO_WIFI_SSID` / `_PASSWORD` | `""` | empty SSID = not provisioned: `echo_wifi_init()` returns `ESP_ERR_INVALID_STATE` instead of scanning forever |
| `ECHO_WIFI_MAX_RETRY` | `0` | 0 = retry forever |
| `ECHO_WIFI_RETRY_DELAY_MS` | `3000` | armed with `esp_timer`, never `vTaskDelay()` inside the event handler |
| `ECHO_WIFI_HOSTNAME` | `echo-cook` | DHCP hostname |
| `ECHO_WIFI_NTP_ENABLED` | `y` | start SNTP on `IP_EVENT_STA_GOT_IP` so `time()` is wall-clock |
| `ECHO_WIFI_NTP_SERVER` | `pool.ntp.org` | NTP server; `ECHO_WIFI_TZ` is applied with `setenv`/`tzset` |
| `ECHO_WIFI_TZ` | `CET-1CEST,M3.5.0,M10.5.0/3` | POSIX TZ used by `localtime_r()` |

`IP_EVENT_STA_GOT_IP` publishes `ECHO_EVT_NET_STATUS` with the RSSI, so the UI and
`echo_ha` react to connectivity without polling. The same handler starts SNTP, so
`time()`/`localtime_r()` return wall-clock time (used by the boot status screen
and the `core.time.*` bundle variables). A failed `esp_wifi_init()`
(typical when the C6 has no ESP-Hosted slave firmware) is logged, posted as
`ECHO_EVT_ERROR` and does **not** abort the boot.

### `echo_ha`

Port of `charlie/echo-devices/libs/ESP32HomeAssistant` to ESP-IDF. Only the
network protocol was ported; the panel, LED, microphone and speaker belong to
other components and are attached through callbacks
(`echo_ha_set_callbacks()`), so the component builds and runs with no audio
hardware.

| Direction | Message |
| --- | --- |
| device → server | `start`, binary 16-bit PCM chunks (4 KB, 2 ms apart), `end` |
| device → server | `{"c":"versions","v":{"lib":"0.1.0","device":<app version>,"type":"echo-cook","mac":"aa:bb:..."}}` — sent on **every** connect and on `getVersions` |
| server → device | `playAudio {conversation,timeout}`, `setWakeUpWordAccuracy {v}`, `setServerIp {v}`, `feedback {v}`, `updateDisplays {v:[{k,texts}]}`, `getVersions`, `OTA` |

* URL `ws://<server>:9303/ws/echo` (`CONFIG_ECHO_HA_SERVER_IP`, `CONFIG_ECHO_HA_PORT`).
  `setServerIp` persists to NVS namespace `echo_ha` (`serverIp`, `wordAcc`) and
  reconnects from a helper task, because the WebSocket task cannot stop itself.
* `esp_websocket_client` (registry, `^1.8.0`) dispatches its events on the default
  event loop, so handlers must stay short: JSON parsing plus event posting only.
* The protocol has **no end-of-reply marker**. Each binary TTS chunk re-arms a
  one-shot timer (`CONFIG_ECHO_HA_TTS_END_TIMEOUT_MS`, default 1200 ms) and silence
  posts `ECHO_EVT_HA_TTS_END` with the `conversation` flag, which is what
  conversation mode reacts to.
* Text commands are reassembled from fragments using `payload_offset` /
  `payload_len` and parsed with cJSON (IDF `json` component).
* `setWakeUpWordAccuracy` is applied by `src/main.cpp` through
  `echo_wakeword_set_threshold()` — `echo_ha` never touches the audio path.
* `OTA` is answered with a log line and `ECHO_EVT_ERROR` (`ESP_ERR_NOT_SUPPORTED`):
  a server-driven update needs a rollback-capable partition layout and a hosted
  image, which is the next phase.

## Deliberately not in P0

* **Wi-Fi / ESP-SR.** The board carries an ESP32-C6 module wired to the P4 over
  SDIO. The host-side stack *is* linked: `src/idf_component.yml` pulls in
  `espressif/esp_wifi_remote` (1.2.5) and `espressif/esp_hosted` (1.4.x), which
  re-implement the normal `esp_wifi` API on top of ESP-Hosted/RPC, so nothing in
  `echo_core` has to change when the radio is used (`echo_wifi` uses exactly that
  API, see *Wi-Fi and the Charlie server* below). Kconfig selects it in the
  *Wi-Fi Remote* menu:

  | Option | Value | Why |
  | --- | --- | --- |
  | `CONFIG_ESP_WIFI_REMOTE_LIBRARY_HOSTED` | `y` | ESP-Hosted transport (not EPPP/CUSTOM) |
  | `CONFIG_SLAVE_IDF_TARGET_ESP32C6` | `y` | the co-processor is a C6 |
  | `CONFIG_ESP_HOSTED_SDIO_HOST_INTERFACE` | `y` | SDIO, not SPI/UART |
  | `CONFIG_ESP_HOSTED_SDIO_PIN_{CLK,CMD,D0..D3}` | `18,19,14,15,16,17` | carrier wiring |
  | `CONFIG_ESP_HOSTED_SDIO_GPIO_RESET_SLAVE` | `54` | C6 `EN`/reset line |

  These are the component defaults for a P4 host with a C6 slave and they match
  the Waveshare carrier; they are pinned explicitly in `sdkconfig.defaults` so a
  future `esp_hosted` release cannot silently change the wiring. The C6 must run
  the ESP-Hosted slave firmware: Waveshare's own Wi-Fi demos assume it is present,
  and if the module was erased it is reflashed over its UART (hold C6_IO9 low, use
  C6_U0RXD/C6_U0TXD). Without it `esp_wifi_init()` fails and the boot continues
  offline. No AP was reachable during this phase, so the station path is compiled
  and unit-reviewed but **not yet smoke-tested on hardware**.
* **Wake word / audio.** The microphone path is wired end to end: `echo_audio`
  captures 16 kHz mono from the ES8311 (I2S0 + the display's legacy I²C port for
  control), `echo_voice` feeds every frame to `echo_wakeword` and, on a detection,
  uploads the utterance to `echo_ha` (`start` / PCM / `end`) and plays the
  server's TTS reply. Detection itself still needs
  `CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED=y` **and** a trained model flashed in the
  `model` partition; without them `echo_wakeword` runs in buffer-only mode and the
  log says so. Upstream, `CONFIG_ECHO_WIFI_ENABLED` and `CONFIG_ECHO_HA_ENABLED`
  (plus a reachable server) must also be on for an utterance to reach Charlie.
  There is no ESP-SR AFE/AEC yet, so detection is *muted* (not cancelled) while
  the device speaks.
* **Recipe editing.** The UI reads the storage partition; there is no editor,
  image support or scaling for very long recipes beyond scrolling.
* **Hardware validation.** No board was attached during this phase, so none of
  the panel/touch behaviour has been observed on real glass yet. The checklist
  for the first flash is below.

## First-flash checklist

1. Confirm the 3.5" panel's controller in `menuconfig -> echo_display`: the
   defaults are ST7796 (RGB565) with CS 20 / RST 21 / DC 22 / MOSI 23 / SCLK 26
   and no backlight GPIO. A garbled or washed-out panel means the module is an
   ILI9488 instead — switch the controller choice, not the pins. If the backlight
   stays dark while the image is visible, the module has a BL pin that is not
   wired to a P4 GPIO here; drive it from 3V3 to confirm the panel, and only then
   assign `CONFIG_ECHO_DISPLAY_SPI_BL_GPIO`.
2. Confirm the touch controller answers on I2C_NUM_1; the log prints the address
   (0x5D or 0x14). If taps land on the wrong axes, enable the matching
   `ECHO_DISPLAY_TOUCH_SWAP_XY` / `_MIRROR_X` / `_MIRROR_Y` option.
3. Check that the boot log reports `LVGL 9.x ready (main=yes aux=yes touch=yes)`
   and that both panels show the recipe screen.
4. Verify the partition table at boot matches `partitions.csv` and that
   `/storage/recipes/*.txt` (e.g. `welcome.txt`, `gratin_dauphinois.txt`) are
   readable with accents intact.
5. If LVGL hits `LV_MEM_SIZE` (allocation warnings), raise
   `CONFIG_LV_MEM_SIZE`; the pool lives in internal RAM.
6. Sensors: the boot log must print `temperature: up, gesture: up` and then one
   `event: 21.4 degC, 48.2 %RH` line every 5 s plus `event: air gesture N` when a
   hand passes over the PAJ7620U2. A DHT22 that always logs `read failed
   (ESP_ERR_TIMEOUT)` is almost always missing its pull-up resistor or wired to a
   pin other than `CONFIG_ECHO_SENSORS_DHT22_GPIO`; a gesture sensor that logs
   `unexpected part id` is on another address (`CONFIG_ECHO_SENSORS_PAJ7620_I2C_ADDR`),
   and `ESP_ERR_INVALID_STATE` from the I2C layer means the DSI panel never came
   up, so the shared port does not exist.
7. Neither sensor has been exercised on real hardware yet — the drivers compile
   and are unit-reviewed only, so treat step 6 as the first smoke test.

### Flashing the app

The app lives in the `factory` slot at `0x10000`, so the stock commands work:

```powershell
pio run -t erase      # only after a partition-table change, or to wipe NVS/SPIFFS
pio run -t upload     # bootloader@0x2000, table@0x8000, app@0x10000
pio device monitor
```

Equivalent manual recovery (fill in the port and the project's image name):

```powershell
python -m esptool --chip esp32p4 -p COM5 -b 460800 --before default-reset --after hard-reset write-flash `
  0x2000   .pio\build\esp32-p4-evboard\bootloader\bootloader.bin `
  0x8000   .pio\build\esp32-p4-evboard\partition_table\partition-table.bin `
  0x10000  .pio\build\esp32-p4-evboard\esp32p4.bin
```

`firmware.factory.bin` (bootloader + table + app merged at `0x0`) is valid and can
be written with `write-flash 0x0 firmware.factory.bin` — **but only if it was built
after the partition table was last changed**. A merged image built against an older
table carries the app at the old offset, so flashing it leaves `factory@0x10000`
erased and the board loops on `invalid magic byte`. When in doubt, run
`pio run -t clean` (or delete `.pio\build\esp32-p4-evboard`) and rebuild before
using the merged image. The `model` and `storage` partitions are not part of the
merged image: flash `hey_charlie.tflite` at `0x900000` and a SPIFFS image at
`0xA00000` separately when you have them.

## Toolchain: PlatformIO Core, pioarduino and SCons

The build is a PlatformIO *framework=espidf* build on top of the pioarduino
ESP32 platform. Those two ship different SCons versions, which is the one
tooling landmine in this project:

| Piece | Version |
| --- | --- |
| `platform` in `platformio.ini` | pioarduino `55.03.311` (zip URL, pinned) |
| PlatformIO Core | `6.2.0.post1` (a *pre-release* of 6.2.0) |
| ESP-IDF | `5.5.5` |
| SCons installed by Core into `packages/tool-scons` | 4.11.1 (`scons-local-4.11.1/`) |
| SCons the pinned platform declares | 4.8.1 → `package-version` `4.40801.0` |

### Symptom and root cause

```
ModuleNotFoundError: No module named 'SCons.Tool.FortranCommon'
```

raised almost immediately, and `~/.platformio/packages/tool-scons` is gone
afterwards.

1. PlatformIO Core treats `tool-scons` as a *core* package and, when it has to
   install it, fetches SCons **4.11.1** (`4.41101.0`) from the URL hard-coded in
   `platformio/dependencies.py`.
2. `pio run` also makes pioarduino's `Espressif32Platform.install_tool()` call
   `_handle_existing_tool()`, which compares the `version` field of
   `packages/tool-scons/package.json` with the `package-version` in its own
   `platform.json` (`~4.40801.0`, i.e. SCons 4.8.1). On a mismatch it logs
   *"Reinstalling tool-scons due to version mismatch"*, **deletes the package
   directory** and re-enters `install_tool()`. In the failing run that second
   call found no `tools.json`, logged *"Tool tool-scons already configured"*
   and returned — the package was never restored, so the SCons process that was
   already running died on the missing module.

Nothing is wrong with the platform, the IDF version or the project; two
different version checks disagree about which SCons should be installed. The
bug only bites when the platform's own reinstall step fails to complete: when
the manager does re-resolve the requirement it simply replaces Core's 4.11.1
with its own 4.8.1 build and the build proceeds (see *verified states* below).

### Fix and runbook

`scripts/fix_pio_tool_scons.py` removes the ambiguity:

* if `packages/tool-scons` is missing or incomplete (`scons.py` absent) it
  installs it through PlatformIO Core's package manager, exactly as Core does at
  startup;
* it then rewrites the `version` field of `package.json` (nothing else) to the
  `package-version` the pinned platform expects, and checks that
  `scons-local*/SCons/Tool/FortranCommon.py` exists — that file is the sentinel
  for "the package is complete", because it is the first import that fails.

With the declared version matching, pioarduino's check passes; if the files are
still Core's 4.11.1 the platform's Tool Manager replaces them with its own
4.8.1 build instead of leaving the directory empty, and Core's `.piopm`-based
check is satisfied either way.

```powershell
# Inspect only: exits 0 when healthy, 1 when a build would break.
python scripts/fix_pio_tool_scons.py --check

# Repair (installs tool-scons if missing, then normalises package.json).
python scripts/fix_pio_tool_scons.py
```

Run it **after any operation that reinstalls or re-verifies tool-scons**:

* `pio pkg install`, `pio pkg update`, `pio upgrade`, `pio platform install`;
* editing the `platform` line in `platformio.ini`;
* deleting `~/.platformio/packages/tool-scons` (e.g. to clean a broken state);
* running the **penv** `pio.exe` (`~/.platformio/penv/Scripts/pio.exe`, Core
  6.2.0.post1) instead of the ambient `pio` on `PATH` (Core 6.1.19). The penv
  build re-installs `tool-scons` 4.11.1 and then dies with
  `ModuleNotFoundError: No module named 'SCons.Tool.FortranCommon'` — observed
  while validating this phase, repaired by re-running the script.

The script reads the expected version from the pinned platform's
`platform.json`, so it keeps working if the pin changes. It deliberately queries
PlatformIO through `~/.platformio/penv` (`pio_python()`): an ambient `python` may
have a *different* PlatformIO release installed (here: Core 6.1.19 from pip,
which pins `tool-scons ~4.40801.0`), while `pio` itself runs Core 6.2.0.post1 from
`penv` and pins the 4.11.1 URL. Installing through the wrong interpreter would
fetch the wrong package, so the penv interpreter always wins.

Verified states on this machine (platform `55.03.311`, Core `6.2.0.post1`):

| `packages/tool-scons` contents | `pio run` result |
| --- | --- |
| `scons-local-4.8.1` + `package.json`/`.piopm` `4.40801.0` | no reinstall, `SUCCESS` in ~20 s on a warm build |
| directory deleted | Tool Manager installs `4.40801.0` (4.8.1), `SUCCESS` |
| Core's `scons-local-4.11.1` + `4.41101.0` (deliberately restored) | Tool Manager replaces it with 4.8.1, `SUCCESS` |
| package deleted *and* reinstall path broken (the original failure) | `ModuleNotFoundError: No module named 'SCons.Tool.FortranCommon'` |

So the end state to aim for is SCons **4.8.1** files with `package.json`
version `4.40801.0` — the version pioarduino tests against. Do not "fix" the
build by leaving Core's 4.11.1 in place with a patched version string for long:
that works, but the platform will keep trying to swap in its own build.

Workarounds that do **not** work, for the record:

* `icacls /deny` on `packages/tool-scons` stops the deletion but leaves a
  half-configured tool that later builds still trip over; the ACL has been
  removed again.
* `pio pkg install -t tool-scons@<url>` is unsupported: tool packages are not
  fetched from the registry by URL, which is why the script goes through
  `platformio.package.manager.core.get_core_package_dir()` instead.

### Transient `kconfgen` failure right after a dependency change

Symptom, seen once when `managed_components` was being re-fetched in the same
run as the configure step:

```
esp_kconfiglib.core.KconfigError: .../managed_components/lvgl__lvgl/Kconfig
not found (in 'source ".../managed_components/lvgl__lvgl/Kconfig"')
CMake Error at .../kconfig.cmake:230 (message): Failed to run kconfgen
```

The component manager writes `.pio/build/<env>/kconfigs.in` from the component
list *before* CMake runs `kconfgen`, and it rewrites `managed_components` at the
same time, so kconfgen can read a directory that is momentarily incomplete (the
`managed_components` mtime lands a few seconds *after* `kconfigs.in`). Nothing
is wrong with the configuration: re-running `pio run` regenerates both in the
right order and succeeds. If it happens twice in a row, delete
`.pio/build/esp32-p4-evboard` (a full reinstall of `managed_components`) — this
is faster and safer than editing `sdkconfig`.

Two messages in the same log are **not** errors and need no action:

* `-- ESP-TEE is currently supported only on the esp32c6;esp32h2;esp32c5 SoCs`
  — printed by IDF's Kconfig every time a P4 config is evaluated.
* `fatal: not a git repository (or any of the parent directories): .git`
  — IDF's version probe for `ESP_IDF_VERSION`; the workspace is not a git repo.

### Version constraints

* Stay on platform `55.03.311` for now. `55.03.312` declares SCons 4.11.1 and
  would remove the mismatch, but it requires PlatformIO Core **≥ 6.2.0 final**;
  the installed `6.2.0.post1` is a pre-release, so the platform's semver check
  rejects it and `pio run` refuses to start. Moving to 55.03.312 is a valid
  cleanup once a final 6.2.x Core is installed — at that point this project no
  longer needs the script (keep it anyway, it is a no-op on a healthy install).
  As of the environment rebuild, `~/.platformio/penv` runs PlatformIO Core
  **6.2.0 final**, so the `55.03.312` move is unblocked whenever it is wanted.
* Build logs (`wifi_build*.log`, `*.err`) are scratch files and are covered by
  `.gitignore`.

## Build time

An incremental `pio run` with nothing to do takes ~20 s; a reconfigure, or a change
to a shared header/component, is a couple of minutes. Two things dominate that time,
and both are trimmed here.

* **The wake-word runtime is only built when it is used.** `esp-tflite-micro`
  (~195 translation units), `esp-dsp` (~174) and `esp-nn` (~30) used to be part of
  every build: they were declared unconditionally in `src/idf_component.yml`, and
  the component manager makes managed dependencies of the declaring component, so
  `src` required them whether or not anything compiled them. They now sit behind a
  Kconfig-gated `rules:` clause, so with `CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED` off
  the component manager never pulls them in (build graph ~1970 -> ~1570 translation
  units, same image bytes). `echo_wakeword` still adds them to `PRIV_REQUIRES` under
  the same condition, so enabling the engine builds them exactly as before.
* **Keep the PlatformIO Python environment single and healthy.** Running `pio` with
  a different interpreter than the one that created `~/.platformio/penv/.espidf-5.5.5`
  makes `builder/penv_setup.py` delete and recreate that virtualenv on every
  invocation (`Python version mismatch ... Recreating penv`). That is slow, and when
  `uv` is unavailable the recreate fails and the build dies with `Failed to install
  Python dependencies into penv`. Invoke a single `pio` (the VS Code PlatformIO IDE
  uses `~/.platformio/penv`). If `~/.platformio/penv/Scripts/python.exe` reports
  `No pyvenv.cfg file`, the venv is broken and must be recreated:

  ```powershell
  Remove-Item -Recurse -Force $env:USERPROFILE\.platformio\penv
  python -m venv $env:USERPROFILE\.platformio\penv
  & $env:USERPROFILE\.platformio\penv\Scripts\python.exe -m pip install platformio
  ```

* **Exclude the build tree from antivirus.** `C:\Workspace\esp32p4` and
  `%USERPROFILE%\.platformio` hold ~340 MB of objects/archives; Defender real-time
  scanning of every compile/link input is a large, avoidable cost on Windows.
* The component manager re-validates the hashes of *all* managed components
  whenever `idf_component.yml` changes. A stale local copy fails this check
  (`The downloaded component "lvgl/lvgl" is corrupted ... "docs/README_pt_BR.md" is
  missing`); delete the offending `managed_components/<vendor>__<name>` directory and
  re-run `pio run` to re-fetch it.

## Verification

`pio run -e esp32-p4-evboard` builds, links, and produces
`firmware.factory.bin`. The generated partition table decoded from the build
matches `partitions.csv` (`nvs@0x9000:24K`, `phy_init@0xF000:4K`,
`factory@0x10000:9152K`, `model@0x900000:1024K`, `storage@0xA00000:6144K`), and
`flash_args` writes the app at `0x10000` — the same offset the merged image uses,
so the factory slot is bootable from every flashing route.

Latest full build (LVGL UI + TFLite-Micro engine + hosted Wi-Fi + sensors):
static RAM 31.8 % (162 836 / 512 000 bytes), flash 6.9 % of the 16 MB device
(1 157 448 bytes), `SUCCESS` in ~530 s from a clean `.pio/build` — most of that
is TFLite-Micro, so expect a couple of minutes for an incremental rebuild after
touching a component.
LVGL's bundled examples are switched off (`CONFIG_LV_BUILD_EXAMPLES`) because
`echo_ui` provides the screens; leaving them on added flash and build time for
widget demos nobody calls.

With `echo_wifi` + `echo_ha` linked, the same build reports `firmware.bin`
1 152 278 bytes (6.9 % of 16 MB) and static RAM 163 280 / 512 000 bytes (31.9 %),
`SUCCESS` (565 s from a reconfigured `.pio/build`, ~150 s incremental). `nm` confirms
`echo_wifi_init/connect` and `echo_ha_start/send_versions` are in the image, and
the component manager downloaded `espressif/esp_websocket_client` 1.8.0 into
`managed_components/` on the first build that referenced it.

With `echo_audio` + `echo_voice` linked (I2S0 to the ES8311 + NS4150B, codec
control over the display's legacy I²C port), the build reports flash 7.8 % of
16 MB (1 300 778 bytes) and `nm` confirms `echo_audio_init/start/play/capture_start`,
`echo_audio_i2c_ctrl_new` and `echo_voice_init` are in the image; the component
manager downloaded `espressif/esp_codec_dev` 1.6.2 into `managed_components/`.
The codec's I²C control interface is a local adapter (`echo_audio_i2c_ctrl.cpp`),
because esp_codec_dev's own adapter needs a new `i2c_master` bus handle on IDF
≥ 5.3 and the display's port is a legacy `driver/i2c` port.

The Kconfig defaults in `components/*/Kconfig` match the committed
`sdkconfig.esp32-p4-evboard`; a mismatch makes the IDF build print
`Default value for <option> in sdkconfig is ... but it is ... according to
Kconfig`, which is how `ECHO_WAKEWORD_ENGINE_ENABLED` was caught (its default
was `n` while the config selected `y`).