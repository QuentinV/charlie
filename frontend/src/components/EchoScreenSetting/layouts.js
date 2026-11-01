/**
 * Physical screen layouts of the Charlie echo devices.
 *
 * This is the single source of truth that maps a firmware `deviceType` to the
 * panels it actually declares in `HAConfig` (`echo-devices/src/main_dashboard*.cpp`).
 * Each panel is addressed by the `k` index used by both the `updateDisplays`
 * command and the `screens` configuration stored per echo.
 *
 * The firmware draws text with the Adafruit GFX defaults (5×7 glyphs, i.e. a
 * 6×8 cell at `ts = 1`) at absolute `cx`/`cy`, so the simulator only needs the
 * native panel size and the index — nothing brand- or integration-specific.
 *
 * `kind`     — `oled` (SSD1306, monochrome) or `tft` (ST77xx, colour; drawn
 *              monochrome here because `_updateDisplay()` never sets a colour).
 * `reserved` — the panel is painted by the firmware itself (the clock strip) and
 *              must never be sent in `updateDisplays`.
 *
 * IMPORTANT: the order of the `panels` array *is* the display order. It is not
 * the `k` order — the dashboard lists its panels as `k = 4, 3, 2, 1` so that
 * Panel 1 is the top-left OLED. Never sort a screen list by `k`: use
 * `orderScreensByLayout()` below so the UI and the saved payload follow this
 * declaration instead of the numeric index.
 */

/** Panel kinds. */
export const PANEL_KIND = {
    OLED: 'oled',
    TFT: 'tft',
};

/** A reserved panel is firmware-owned: read-only in the UI, stripped on save. */
export const RESERVED_CLOCK = 'clock';

const clockPanel = (w, h) => ({
    k: 0,
    w,
    h,
    kind: PANEL_KIND.OLED,
    reserved: RESERVED_CLOCK,
    label: 'Clock strip',
    note: 'Driven by the firmware: shows the time, never refreshed by Charlie.',
});

/**
 * Layouts keyed by the firmware `deviceType` reported by the echo device.
 */
export const DEVICE_LAYOUTS = {
    'echo-dashboard': {
        title: 'Echo dashboard',
        description:
            'One 128×32 clock strip and four 128×64 OLED panels (TCA9548A channels 0–4).',
        gridTemplateAreas: `"k0 k0" "k4 k3" "k1 k2"`,
        gridTemplateColumns: '1fr 1fr',
        panels: [
            clockPanel(128, 32),
            { k: 4, w: 128, h: 64, kind: PANEL_KIND.OLED, label: 'Panel 4' },
            { k: 3, w: 128, h: 64, kind: PANEL_KIND.OLED, label: 'Panel 3' },
            { k: 1, w: 128, h: 64, kind: PANEL_KIND.OLED, label: 'Panel 1' },
            { k: 2, w: 128, h: 64, kind: PANEL_KIND.OLED, label: 'Panel 2' },
        ],
    },
    'echo-dashboard-weather': {
        title: 'Echo dashboard (weather)',
        description:
            'A 128×32 clock strip, two 128×64 OLED panels and one 128×160 TFT.',
        gridTemplateAreas: `"k0 k0" "k2 k3" "k1 k3"`,
        gridTemplateColumns: '1fr 1fr',
        panels: [
            clockPanel(128, 32),
            { k: 1, w: 128, h: 64, kind: PANEL_KIND.OLED, label: 'Panel 1' },
            { k: 2, w: 128, h: 64, kind: PANEL_KIND.OLED, label: 'Panel 2' },
            { k: 3, w: 128, h: 160, kind: PANEL_KIND.TFT, label: 'TFT panel' },
        ],
    },
};

/** Size assumed for a screen of an unknown firmware type. */
const GENERIC_PANEL = { w: 128, h: 64, kind: PANEL_KIND.OLED };

/**
 * Resolve the panels of a device.
 *
 * A known `deviceType` returns its declared panels. Anything else (a firmware
 * added after this file was written, or a device that has not reported its type
 * yet) gets one generic 128×64 panel per configured `k`, so no saved screen is
 * ever hidden — it is simply rendered with an approximate size.
 *
 * @param {string} [deviceType]
 * @param {{ k?: number }[]} [screens] Saved screens, used to discover the `k`s.
 * @returns {{ title: string, description: string, known: boolean, panels: object[] }}
 */
export function resolveLayout(deviceType, screens) {
    const layout = DEVICE_LAYOUTS[deviceType];
    if (layout) return { ...layout, known: true };

    const keys = new Set([0]);
    for (const screen of screens ?? []) {
        keys.add(Number(screen?.k ?? 0));
    }

    return {
        title: deviceType ? `Unknown firmware (${deviceType})` : 'Echo device',
        description:
            'This firmware type is not described yet, so panels are shown as generic 128×64 OLED screens.',
        known: false,
        gridTemplateAreas: '',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        panels: [...keys]
            .sort((a, b) => a - b)
            .map((k) =>
                k === 0
                    ? clockPanel(GENERIC_PANEL.w, 32)
                    : { k, ...GENERIC_PANEL, label: `Panel ${k}` }
            ),
    };
}

/** True when a panel must never appear in `updateDisplays`. */
export const isReservedPanel = (panel) => !!panel?.reserved;

/**
 * Order screens the way the panels are listed in `DEVICE_LAYOUTS`.
 *
 * The `panels` array order *is* the display order — it is not the `k` order
 * (the dashboard lists its panels as `k = 4, 3, 2, 1` so the top-left OLED is
 * Panel 1). Screens the layout does not declare keep their own ascending order
 * after the declared ones, so nothing is ever dropped.
 *
 * @param {{ k: number }[]} panels Layout panels, in display order.
 * @param {{ k: number }[]} screens Saved screens, in any order.
 * @returns {{ k: number }[]} The same screen objects, reordered.
 */
export function orderScreensByLayout(panels, screens) {
    const rank = new Map();
    panels.forEach((panel, index) => {
        if (!rank.has(panel.k)) rank.set(panel.k, index);
    });

    const rankOf = (k) => (rank.has(k) ? rank.get(k) : Number.MAX_SAFE_INTEGER);

    return [...screens].sort((a, b) => {
        const ra = rankOf(a.k);
        const rb = rankOf(b.k);
        if (ra !== rb) return ra - rb;
        return Number(a.k) - Number(b.k);
    });
}
