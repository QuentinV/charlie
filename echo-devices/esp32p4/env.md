# Module on/off toggles (bring-up & testing)

How to enable/disable one subsystem at a time while bringing the board up.
Nothing here needs code changes: every module is already gated by a Kconfig
boolean, and the firmware degrades gracefully (logs an error, keeps booting) when
a module is off.

## Where the switch lives

The **live** configuration is the file `sdkconfig.esp32-p4-evboard` (committed to
git). `sdkconfig.defaults` only seeds a *fresh* config, so editing it does **not**
change an existing build. Change a module in one of two ways.

### Option A — menuconfig (recommended)

```powershell
pio run -t menuconfig
```

Open the matching menu and toggle the option:

| Menu | What it holds |
| --- | --- |
| `echo_display` | 10.1" DSI panel, 3.5" SPI panel, touch |
| `echo_sensors` | DHT22, PAJ7620U2 |
| `echo_wifi` | hosted Wi-Fi station |
| `echo_ha (Charlie server)` | Charlie WebSocket client |
| `echo_wakeword` | TFLite "Hey Charlie" engine |

Save and quit; the next `pio run` reconfigures automatically.

### Option B — edit `sdkconfig.esp32-p4-evboard` directly

PlatformIO re-runs CMake whenever this file is newer than
`.pio/build/esp32-p4-evboard/CMakeCache.txt`, so a save is picked up on the next
build. A boolean is written in exactly one of these two forms:

```
CONFIG_ECHO_DISPLAY_SPI_ENABLED=y            # enabled
# CONFIG_ECHO_DISPLAY_SPI_ENABLED is not set # disabled
```

> Do **not** write `CONFIG_ECHO_DISPLAY_SPI_ENABLED=n` — ESP-IDF only recognises
> the `# ... is not set` form for a disabled bool. Replace the whole line.

Then build:

```powershell
pio run -e esp32-p4-evboard
```

Only run `pio run -t clean` (or delete `.pio/build/esp32-p4-evboard`) if you also
changed a Kconfig `depends on` structure, not for a plain on/off toggle.

## The module map

| Kconfig symbol | Module | Default | When off |
| --- | --- | --- | --- |
| `CONFIG_ECHO_DISPLAY_DSI_ENABLED` | 10.1" DSI panel (JD9365) = `ECHO_DISPLAY_MAIN` | `y` | driver still compiles but is not initialised; `main` stays down, no boot screen on the 10.1" |
| `CONFIG_ECHO_DISPLAY_SPI_ENABLED` | 3.5" SPI panel (ST7796/ILI9488) = `ECHO_DISPLAY_AUX` | `y` | `echo_display_spi_*` stubs return `NOT_SUPPORTED`/`false`; `aux` down |
| `CONFIG_ECHO_DISPLAY_TOUCH_ENABLED` | Touch on the 10.1" (GT911/GT9271) | `y` | touch task not started; no `ECHO_EVT_GESTURE`, no LVGL pointer indev |
| `CONFIG_ECHO_WIFI_ENABLED` | Hosted Wi-Fi station (P4 → C6 over SDIO) | `y` | `echo_wifi_connect()` not called; skips the hosted `esp_wifi_init()` RPC wait |
| `CONFIG_ECHO_HA_ENABLED` | Charlie server WebSocket client | `y` | `echo_ha_start()` not called |
| `CONFIG_ECHO_SENSORS_DHT22_ENABLED` | DHT22 temperature/humidity | `y` | no `ECHO_EVT_TEMPERATURE`, GPIO5 unused |
| `CONFIG_ECHO_SENSORS_PAJ7620_ENABLED` | PAJ7620U2 air gestures | `y` | no `ECHO_EVT_AIR_GESTURE`, no extra I2C traffic |
| `CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED` | TFLite "Hey Charlie" engine | `y` | engine glue not built and the TFLite runtime is not linked in (smaller image); note the `espressif__esp-tflite-micro` managed component still *compiles*, so build time is unchanged |
| `CONFIG_ECHO_STATUS_ENABLED` | Boot status screen (`echo_status`) | `y` | `echo_status_init()` no-ops; no status page (the panels keep the waiting message / Charlie UI) |
| `CONFIG_ECHO_WIFI_NTP_ENABLED` | SNTP once an IP is obtained (inside `echo_wifi`) | `y` | the clock stays at 1970, so the status "Time" row and `core.time.*` show "not synced" |

> `echo_core` (event bus, NVS, SPIFFS) and `echo_ui` (LVGL) are always compiled.
> `echo_ui` starts as long as **at least one** panel is up and only creates an
> LVGL display for panels that are actually ready, so turning the SPI panel off
> gives you a 10.1"-only UI automatically.
>
> `echo_status` is a one-shot sibling of `echo_screen`: 5 s after boot it paints a
> status page on the 10.1" (`ECHO_STATUS_DELAY_MS`/`_WINDOW_MS`; `_SHOW_AUX` also
> shows "Welcome to EchoCook" on the 3.5"), plays a short chime
> (`_PLAY_SOUND`, needs `echo_audio`) and then hands the screens back to
> `echo_screen`.


## Preset — STEP 1: 10.1" screen only

Everything except the 10.1" assembly off. This isolates the DSI bring-up, skips
the SDIO/RPC and sensor I2C traffic, and keeps the boot log easy to read.

| Symbol | Value |
| --- | --- |
| `CONFIG_ECHO_DISPLAY_DSI_ENABLED` | `y` |
| `CONFIG_ECHO_DISPLAY_TOUCH_ENABLED` | `y` |
| `CONFIG_ECHO_DISPLAY_SPI_ENABLED` | off |
| `CONFIG_ECHO_WIFI_ENABLED` | off |
| `CONFIG_ECHO_HA_ENABLED` | off |
| `CONFIG_ECHO_SENSORS_DHT22_ENABLED` | off |
| `CONFIG_ECHO_SENSORS_PAJ7620_ENABLED` | off |
| `CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED` | off |

The exact lines to end up with in `sdkconfig.esp32-p4-evboard`:

```
CONFIG_ECHO_DISPLAY_DSI_ENABLED=y
CONFIG_ECHO_DISPLAY_TOUCH_ENABLED=y
# CONFIG_ECHO_DISPLAY_SPI_ENABLED is not set
# CONFIG_ECHO_WIFI_ENABLED is not set
# CONFIG_ECHO_HA_ENABLED is not set
# CONFIG_ECHO_SENSORS_DHT22_ENABLED is not set
# CONFIG_ECHO_SENSORS_PAJ7620_ENABLED is not set
# CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED is not set
```

To also prove the panel with **no** I2C traffic, additionally set
`# CONFIG_ECHO_DISPLAY_TOUCH_ENABLED is not set`.

Expected boot log:

```
I (xxx) echo_display: JD9365 up: 800x1280 RGB888, fb 0x...
I (xxx) echo_display: display stack ready
I (xxx) app: panels: main=up aux=down
I (xxx) app: touch: up
I (xxx) echo_ui: LVGL 9.x ready (main=yes aux=no touch=yes)
```

The 10.1" shows the slate boot screen, then the recipe screen.

## Later steps — bring modules back one at a time

| Step | Turn on | Then check in the log |
| --- | --- | --- |
| 2 | `..._DISPLAY_SPI_ENABLED=y` | `aux=up`; the 3.5" shows the boot screen / UI |
| 3 | `..._SENSORS_DHT22_ENABLED=y` | `temperature: up` + `event: .. degC, .. %RH` every 5 s |
| 4 | `..._SENSORS_PAJ7620_ENABLED=y` | `gesture: up` + `event: air gesture N` |
| 5 | `..._WIFI_ENABLED=y` (+ SSID/password in the `echo_wifi` menu) | `wifi: online` (or `pending`) |
| 6 | `..._HA_ENABLED=y` (+ `CONFIG_ECHO_HA_SERVER_IP`) | `event: charlie server connected` |
| 7 | `..._WAKEWORD_ENGINE_ENABLED=y` | engine attaches; the TFLite runtime gets linked in |

## Caveats

* Turning a module off is a **safety net, not a fix**: a module that fails to
  bring up still logs its own error (`echo_display: DSI panel failed: ...`), so
  keep the boot log at hand when re-enabling one.
* `CONFIG_ECHO_WIFI_ENABLED=y` with no ESP-Hosted slave firmware on the C6 makes
  the hosted `esp_wifi_init()` block on RPC. Leave Wi-Fi off while testing
  displays.
* Editing `sdkconfig.esp32-p4-evboard` dirties git. Restore the committed
  baseline with `git checkout -- sdkconfig.esp32-p4-evboard`.
* Every module change triggers a full CMake reconfigure; the first build after a
  toggle is slower than an incremental one.

## Build notes

* When `sdkconfig` differs from a Kconfig default the IDF build prints, once per
  option, e.g.
  `info: Default value for ECHO_WIFI_ENABLED in sdkconfig is n but it is y
  according to Kconfig. Using default value from sdkconfig (n).`
  This is **expected and harmless**: the `sdkconfig` value (here `n`) wins, which
  is exactly what a toggle wants. No action required.
* If a build dies with `ModuleNotFoundError: No module named
  'SCons.Tool.FortranCommon'`, run `python scripts/fix_pio_tool_scons.py` (see
  `docs/P0_INFRASTRUCTURE.md`, "Toolchain"). pioarduino reinstalls `tool-scons`
  whenever the PlatformIO Core version changes, which re-triggers the bug.
* Verified: the STEP 1 preset above builds clean —
  `RAM 30.5% (156224 / 512000 B)`, `Flash 4.4% (745472 B)`,
  `firmware.factory.bin` produced (`[SUCCESS]`).
* Prefer the PlatformIO Core in `~/.platformio/penv`
  (`~/.platformio/penv/Scripts/pio.exe`, or `python -m platformio` from that
  interpreter). The ambient `pio` on `PATH` is a *different, older* Core; when its
  Python version disagrees with the penv it wipes and tries to recreate the penv,
  which can fail and leave the toolchain broken.
