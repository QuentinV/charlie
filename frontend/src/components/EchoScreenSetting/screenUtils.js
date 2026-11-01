/**
 * Helpers shared by the echo screen simulator.
 *
 * The firmware replaces `{{device:Name:path}}` at refresh time (see
 * `nodejs-apis/src/echo/screensUpdates.ts`): the text stored in Mongo keeps the
 * placeholder, the device receives the resolved value. The simulator mirrors
 * that pipeline locally so the Preview mode can render a screen without ever
 * touching a device.
 */

/** Placeholder syntax, identical to `resolveScripting()` on the server. */
export const PLACEHOLDER_SOURCE = '\\{\\{device:([^:]+?):([^}]+?)\\}\\}';

/** Default text item, mirroring the Adafruit GFX defaults used by the firmware. */
export const DEFAULT_TEXT = {
    ts: 1,
    v: '',
    cx: 2,
    cy: 2,
    r: 0,
};

/** Glyph cell of the Adafruit default font, in pixels, at `ts = 1`. */
export const CHAR_WIDTH = 6;
export const CHAR_HEIGHT = 8;

/** Build a `{{device:Name:path}}` token. */
export const buildPlaceholder = (deviceName, path) =>
    `{{device:${deviceName}:${path}}}`;


/**
 * Every `{{device:...}}` occurrence of a text value.
 * @param {string} [value]
 * @returns {{ raw: string, device: string, path: string }[]}
 */
export function parsePlaceholders(value) {
    const found = [];
    if (!value) return found;

    const regex = new RegExp(PLACEHOLDER_SOURCE, 'g');
    let match;
    while ((match = regex.exec(value)) !== null) {
        found.push({ raw: match[0], device: match[1], path: match[2] });
    }
    return found;
}

/**
 * Replace placeholders with preview overrides.
 *
 * A placeholder without an override is left untouched, exactly like the server
 * leaves it when the device is unknown: the user must be able to see which part
 * of the text is dynamic.
 *
 * @param {string} [value]
 * @param {Record<string, string>} [overrides] keyed by the full `{{...}}` token
 */
export function substitutePlaceholders(value, overrides = {}) {
    if (!value) return '';
    return value.replace(
        new RegExp(PLACEHOLDER_SOURCE, 'g'),
        (full) => overrides[full] ?? full
    );
}

/**
 * Distinct placeholders used across a set of screens, in first-seen order.
 * @param {{ texts?: { v?: string }[] }[]} [screens]
 */
export function collectPlaceholders(screens) {
    const seen = new Map();
    for (const screen of screens ?? []) {
        for (const text of screen?.texts ?? []) {
            for (const placeholder of parsePlaceholders(text?.v)) {
                if (!seen.has(placeholder.raw)) seen.set(placeholder.raw, placeholder);
            }
        }
    }
    return [...seen.values()];
}

/**
 * Approximate width of a text once drawn, using the Adafruit cell grid rather
 * than the browser font metrics: the simulator must predict what the firmware
 * prints, not what the browser measures.
 * @param {{ v?: string, ts?: number }} text
 */
export const textWidth = (text) =>
    (text?.v?.length ?? 0) * CHAR_WIDTH * (text?.ts ?? 1);

/** Approximate height of a text item (single line, no wrap). */
export const textHeight = (text) => CHAR_HEIGHT * (text?.ts ?? 1);
