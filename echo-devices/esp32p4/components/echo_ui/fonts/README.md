# Fonts for the Echo-Cook UI

`echo_font_16.c`, `echo_font_20.c`, `echo_font_28.c` are generated LVGL 9 fonts,
not hand-written code. They cover:

* ASCII (`0x20-0x7F`)
* Latin-1 Supplement (`0x80-0xFF`), so French accents (`é`, `è`, `à`, `ç`, `œ`
  is not in Latin-1 but `°`, `€` are) render from the UTF-8 recipe files
* `–`, `—`, `‘`, `’`, `“`, `”`, `•`, `…`

Source font: `DejaVuSans.ttf`, the copy bundled with LVGL under
`managed_components/lvgl__lvgl/scripts/generators/built_in_font/`
(DejaVu license, see that directory). Using LVGL's own copy keeps the build
reproducible and avoids shipping a system font.

Regenerate with `lv_font_conv` (Node, run with `npx`):

```powershell
npx --yes lv_font_conv --size 28 --bpp 4 --format lvgl `
  --font managed_components/lvgl__lvgl/scripts/generators/built_in_font/DejaVuSans.ttf `
  -r 0x20-0xFF -r 0x2013-0x2014 -r 0x2018-0x201D -r 0x2022 -r 0x2026 `
  --lv-include lvgl.h --lv-font-name echo_font_28 `
  --force-fast-kern-format -o components/echo_ui/fonts/echo_font_28.c
```

Repeat with `--size 20` / `--size 16` and the matching `--lv-font-name` /
output file. The generated file exposes `const lv_font_t echo_font_NN`, declared
in `echo_ui.cpp` with `LV_FONT_DECLARE()`.

Fonts outside Latin-1 (CJK, emoji) fall back to LVGL's placeholder box; add
ranges here and regenerate if recipes need them.