/**
 * Adafruit GFX <-> native canvas transforms.
 *
 * The firmware draws with `setTextSize(ts)`, `setCursor(cx, cy)` and
 * `setRotation(r)` (`ESP32HomeAssistant::_updateDisplay`). `setRotation` takes a
 * quadrant (`rotation = r & 3`) and remaps every pixel, so the cursor lives in a
 * rotated coordinate space: a 128×32 strip drawn with `r = 1` has a 32×128 logic
 * grid, not a 128×32 one.
 *
 * `Adafruit_SSD1306::drawPixel()` maps a logical `(x, y)` onto the native panel
 * with (W/H being the panel's *native* size, constant whatever the rotation):
 *
 *   r = 0 → (x, y)
 *   r = 1 → (W - 1 - y, x)
 *   r = 2 → (W - 1 - x, H - 1 - y)
 *   r = 3 → (y, H - 1 - x)
 *
 * Both directions are needed: the first to draw a preview that matches the
 * device, the second to turn a click or a drag into the text's own coordinates.
 */

/** Normalise any `r` to a quadrant, exactly like Adafruit's `x & 3`. */
export const normalizeRotation = (r) => ((Number(r) || 0) & 3);

/**
 * Apply the Adafruit quadrant transform to a 2D context.
 * Call inside `ctx.save()` / `ctx.restore()`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} r Rotation quadrant (0–3).
 * @param {number} w Native panel width.
 * @param {number} h Native panel height.
 */
export function applyRotation(ctx, r, w, h) {
    switch (normalizeRotation(r)) {
        case 1:
            ctx.translate(w - 1, 0);
            ctx.rotate(Math.PI / 2);
            break;
        case 2:
            ctx.translate(w - 1, h - 1);
            ctx.rotate(Math.PI);
            break;
        case 3:
            ctx.translate(0, h - 1);
            ctx.rotate(-Math.PI / 2);
            break;
        default:
            break;
    }
}

/**
 * Inverse of {@link applyRotation}: native panel point → text coordinates.
 *
 * @param {number} px Native x, in device pixels.
 * @param {number} py Native y, in device pixels.
 * @param {number} r Rotation quadrant (0–3).
 * @param {number} w Native panel width.
 * @param {number} h Native panel height.
 * @returns {{ x: number, y: number }}
 */
export function physicalToLogical(px, py, r, w, h) {
    switch (normalizeRotation(r)) {
        case 1:
            return { x: py, y: w - 1 - px };
        case 2:
            return { x: w - 1 - px, y: h - 1 - py };
        case 3:
            return { x: h - 1 - py, y: px };
        default:
            return { x: px, y: py };
    }
}
