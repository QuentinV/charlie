import React, { useCallback, useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { CHAR_HEIGHT, CHAR_WIDTH, substitutePlaceholders } from './screenUtils';
import {
    applyRotation,
    normalizeRotation,
    physicalToLogical,
} from './screenTransforms';

/**
 * Canvas simulator of one physical display.
 *
 * The firmware (`ESP32HomeAssistant::_updateDisplay`) clears the panel then, for
 * every text, calls `setTextSize(ts)`, `setCursor(cx, cy)`, `setRotation(r)` and
 * `print(v)` — in that order, so the rotation applies to the cursor coordinates
 * too. `applyRotation()` reproduces Adafruit's pixel mapping as a canvas
 * transform so the preview matches what the device prints, and
 * `physicalToLogical()` (both in `screenTransforms.js`) is its inverse, used to
 * turn a click or a drag into the text's own coordinates.
 */


/** Adafruit's default font is monospaced: one cell per glyph. */
const glyphFont = (ts) => `${CHAR_HEIGHT * ts}px "Courier New", Courier, monospace`;

const textColor = '#f2f2f2';

/** Draw the empty panel background + a light pixel grid for alignment. */
function paintBackground(ctx, panel) {
    const { w, h, kind } = panel;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle =
        kind === 'tft' ? 'rgba(90,140,255,0.16)' : 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    for (let x = 16; x < w; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
        ctx.stroke();
    }
    for (let y = 16; y < h; y += 16) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
        ctx.stroke();
    }
}

/** Paint the firmware-owned clock strip. */
function paintClock(ctx, panel) {
    const { w, h } = panel;
    // The firmware centres a size-4 "HH:MM" vertically on the strip.
    const ts = 4;
    ctx.save();
    ctx.font = glyphFont(ts);
    ctx.textBaseline = 'top';
    ctx.fillStyle = textColor;
    const label = '12:34';
    const width = label.length * CHAR_WIDTH * ts;
    ctx.fillText(
        label,
        Math.max(0, Math.round((w - width) / 2)),
        Math.round((h - CHAR_HEIGHT * ts) / 2)
    );
    ctx.restore();
}

/**
 * @param {object} props
 * @param {object} props.panel Panel definition from `layouts.js`.
 * @param {{ ts?: number, v?: string, cx?: number, cy?: number, r?: number }[]} props.texts
 * @param {number|null} [props.selectedIndex]
 * @param {(index: number|null) => void} [props.onSelect]
 * @param {(index: number, cx: number, cy: number) => void} [props.onMove]
 * @param {boolean} [props.preview] Render placeholders replaced by `overrides`.
 * @param {Record<string, string>} [props.overrides]
 * @param {boolean} [props.readOnly]
 * @param {number} [props.scale] CSS pixels per device pixel.
 */
export const ScreenCanvas = ({
    panel,
    texts = [],
    selectedIndex = null,
    onSelect,
    onMove,
    preview = false,
    overrides = {},
    readOnly = false,
    scale = 2,
}) => {
    const canvasRef = useRef(null);
    /** Extents measured while drawing, in logical coordinates (hit-testing). */
    const extentsRef = useRef([]);
    const dragRef = useRef(null);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const { w, h } = panel;

        paintBackground(ctx, panel);

        if (panel.reserved) {
            paintClock(ctx, panel);
            extentsRef.current = [];
            return;
        }

        const extents = [];
        texts.forEach((text, index) => {
            const ts = Math.max(1, Number(text.ts) || 1);
            const cx = Number(text.cx) || 0;
            const cy = Number(text.cy) || 0;
            const value = preview
                ? substitutePlaceholders(text.v, overrides)
                : text.v ?? '';

            ctx.save();
            applyRotation(ctx, text.r, w, h);
            ctx.font = glyphFont(ts);
            ctx.textBaseline = 'top';
            ctx.fillStyle = textColor;
            ctx.fillText(value, cx, cy);

            const width = Math.max(
                ctx.measureText(value || ' ').width,
                CHAR_WIDTH * ts
            );
            const height = CHAR_HEIGHT * ts;
            extents.push({ cx, cy, width, height });

            if (index === selectedIndex) {
                ctx.strokeStyle = '#4fc3f7';
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                ctx.strokeRect(cx - 0.5, cy - 0.5, width + 1, height + 1);
                ctx.setLineDash([]);
            }
            ctx.restore();
        });
        extentsRef.current = extents;
    }, [panel, texts, selectedIndex, preview, overrides]);

    useEffect(() => {
        draw();
    }, [draw]);

    /** Native panel coordinates of a pointer event. */
    const toPanelPoint = (event) => {
        const rect = canvasRef.current.getBoundingClientRect();
        return {
            px: ((event.clientX - rect.left) / rect.width) * panel.w,
            py: ((event.clientY - rect.top) / rect.height) * panel.h,
        };
    };

    /** Topmost text under a native point, or `null`. */
    const hitTest = (px, py) => {
        const extents = extentsRef.current;
        for (let index = texts.length - 1; index >= 0; index -= 1) {
            const extent = extents[index];
            if (!extent) continue;
            const point = physicalToLogical(
                px,
                py,
                texts[index].r,
                panel.w,
                panel.h
            );
            if (
                point.x >= extent.cx &&
                point.x <= extent.cx + extent.width &&
                point.y >= extent.cy &&
                point.y <= extent.cy + extent.height
            ) {
                return index;
            }
        }
        return null;
    };

    const handlePointerDown = (event) => {
        if (readOnly || panel.reserved) return;
        const point = toPanelPoint(event);
        const index = hitTest(point.px, point.py);
        onSelect?.(index);
        if (index === null) return;

        const text = texts[index];
        const grabbed = physicalToLogical(
            point.px,
            point.py,
            text.r,
            panel.w,
            panel.h
        );
        dragRef.current = {
            index,
            cx0: Number(text.cx) || 0,
            cy0: Number(text.cy) || 0,
            r: normalizeRotation(text.r),
            grabX: grabbed.x,
            grabY: grabbed.y,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };

    const handlePointerMove = (event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const point = toPanelPoint(event);
        // Invert with the *original* cursor so a drag cannot feed back into its
        // own coordinates (the cursor moves while the text does).
        const moved = physicalToLogical(
            point.px,
            point.py,
            drag.r,
            panel.w,
            panel.h
        );
        // Odd quadrants swap the axes: keep the cursor inside the *logical*
        // space so a text can never be dragged off its panel and lost.
        const maxX = drag.r % 2 === 1 ? panel.h : panel.w;
        const maxY = drag.r % 2 === 1 ? panel.w : panel.h;
        const clamp = (value, max) => Math.min(Math.max(value, 0), max);
        onMove?.(
            drag.index,
            clamp(Math.round(drag.cx0 + (moved.x - drag.grabX)), maxX),
            clamp(Math.round(drag.cy0 + (moved.y - drag.grabY)), maxY)
        );
    };

    const endDrag = () => {
        dragRef.current = null;
    };

    return (
        <Box sx={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
            <canvas
                ref={canvasRef}
                width={panel.w}
                height={panel.h}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{
                    width: '100%',
                    maxWidth: panel.w * scale,
                    aspectRatio: `${panel.w} / ${panel.h}`,
                    imageRendering: 'pixelated',
                    display: 'block',
                    border: '1px solid #3a3a3a',
                    borderRadius: 4,
                    backgroundColor: '#000',
                    cursor:
                        readOnly || panel.reserved ? 'default' : 'crosshair',
                    touchAction: 'none',
                }}
            />
        </Box>
    );
};

export default ScreenCanvas;

