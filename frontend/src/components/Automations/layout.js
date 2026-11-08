// Pure geometry for the read-only automations graph.
//
// No React / no DOM: it turns the stored `{ nodes, edges }` subgraphs into
// positioned boxes and edge paths so the SVG component only draws. Every
// automation becomes one horizontal band, so the whole house is one picture
// ("one big graph in one view"); a node with an explicit `position` keeps it,
// otherwise the depth is derived from the graph shape (left → right).

export const KIND_COLORS = {
    trigger: '#FFB300', // amber — what wakes the branch
    condition: '#B388FF', // violet — a gate
    action: '#4EC8F5', // blue — a natural-language action
    notify: '#4CD964', // green — a push notification
};

const COL_W = 280; // horizontal step between depths
const NODE_W = 200;
const MARGIN_X = 28;
const BAND_GAP = 48;

// A node grows with its wrapped label: the kind caption sits on top and the
// label lines under it, so every word stays visible (never ellipsized).
const NODE_PAD_TOP = 38; // caption + gap above the first label line
const LABEL_LINE_H = 15;
const LABEL_FONT = 12.5;
const NODE_PAD_BOTTOM = 14;
const ROW_GAP = 18; // breathing space between two stacked nodes
const BAND_TITLE_FONT = 15;
const TITLE_TOP = 28; // baseline of the first title line
const TITLE_LINE_H = 20;
const TITLE_PAD = 18; // gap between the title block and the first node
const BAND_PAD_BOTTOM = 22;

/** Cubic bezier bending between two horizontally-aligned boxes. */
export function edgePath(x1, y1, x2, y2) {
    const dx = Math.max(Math.abs(x2 - x1) * 0.5, 40);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
}

/**
 * Depth of every node: a trigger is always depth 0, everything else is one past
 * its deepest predecessor. Relaxation (not a single pass) so diamonds settle.
 */
export function computeDepths(nodes, edges) {
    const ids = new Set((nodes ?? []).map((n) => n.id));
    const preds = new Map();
    for (const e of edges ?? []) {
        if (!ids.has(e.from) || !ids.has(e.to)) continue;
        const list = preds.get(e.to) ?? [];
        list.push(e.from);
        preds.set(e.to, list);
    }

    const depth = new Map((nodes ?? []).map((n) => [n.id, 0]));
    for (let iter = 0; iter < (nodes?.length ?? 0) + 1; iter++) {
        let changed = false;
        for (const n of nodes ?? []) {
            const incoming = preds.get(n.id) ?? [];
            let d = n.kind === 'trigger' ? 0 : depth.get(n.id) ?? 0;
            for (const p of incoming) {
                d = Math.max(d, (depth.get(p) ?? 0) + 1);
            }
            if (n.kind === 'trigger') d = 0;
            if (d !== depth.get(n.id)) {
                depth.set(n.id, d);
                changed = true;
            }
        }
        if (!changed) break;
    }
    return depth;
}

/** Human label for a node, resolving a device id when the caller knows it. */
export function nodeLabel(node, deviceName) {
    const device =
        deviceName ??
        node.trigger?.device?.deviceId ??
        node.condition?.deviceId ??
        '';
    switch (node.kind) {
        case 'trigger': {
            const t = node.trigger;
            if (!t) return 'trigger';
            if (t.type === 'CRON') return `⏰ ${t.cron?.expression ?? ''}`;
            if (t.type === 'DEVICE_STATE') {
                const d = t.device;
                return `${device} · ${d?.attribute ?? ''} → ${
                    d?.to ?? 'change'
                }`;
            }
            if (t.type === 'EVENT') return `↳ ${t.event || 'action done'}`;
            return '▶ manual';
        }
        case 'action':
            return node.action?.text || 'action';
        case 'notify':
            return node.notify?.body || 'notify';
        case 'condition': {
            const c = node.condition;
            const value = Array.isArray(c?.value)
                ? c.value.join('–')
                : c?.value ?? '';
            return `${device} ${c?.attribute ?? ''} ${c?.op ?? ''} ${value}`;
        }
        default:
            return node.label ?? node.id;
    }
}

/**
 * Rough advance width of a string in a UI sans-serif. SVG offers no measurement
 * at layout time, so we estimate ~0.53em per glyph, a little more for caps and
 * digits, less for spaces and narrow letters — good enough to wrap on.
 */
function textWidth(text, fontSize) {
    let units = 0;
    for (const ch of String(text ?? '')) {
        if (ch === ' ') units += 0.28;
        else if (/[A-Z0-9]/.test(ch)) units += 0.62;
        else if (/[.,:;'’!|iljtf()]/.test(ch)) units += 0.32;
        else units += 0.53;
    }
    return units * fontSize;
}

/**
 * Greedy word wrap: a word stays whole whenever it can, and a word wider than a
 * whole line is hard-broken — so no character is ever dropped. Returns at least
 * one line, so callers can always render something.
 */
export function wrapText(text, maxWidth, fontSize) {
    const value = String(text ?? '').trim();
    if (!value) return [''];

    const lines = [];
    let line = '';
    const flush = () => {
        if (line) lines.push(line);
        line = '';
    };

    for (const word of value.split(/\s+/)) {
        if (line && textWidth(`${line} ${word}`, fontSize) <= maxWidth) {
            line = `${line} ${word}`;
            continue;
        }
        flush();
        if (textWidth(word, fontSize) <= maxWidth) {
            line = word;
            continue;
        }
        let chunk = '';
        for (const ch of word) {
            if (chunk && textWidth(chunk + ch, fontSize) > maxWidth) {
                lines.push(chunk);
                chunk = ch;
            } else {
                chunk += ch;
            }
        }
        line = chunk;
    }
    flush();
    return lines.length ? lines : [''];
}

/**
 * Lay every automation out as its own band and stack them vertically.
 * @param {any[]} automations
 * @param {(node: any) => (string | undefined)} [deviceName]
 */
export function layoutAutomations(automations, deviceName) {
    const bands = [];
    const nodes = [];
    const links = [];

    let cursorY = 0;
    let maxWidth = 0;

    for (const automation of automations ?? []) {
        const sourceNodes = automation.nodes ?? [];
        const edges = automation.edges ?? [];
        const depth = computeDepths(sourceNodes, edges);

        // Group ids by depth to stack siblings vertically.
        const byDepth = new Map();
        for (const n of sourceNodes) {
            const d = depth.get(n.id) ?? 0;
            const list = byDepth.get(d) ?? [];
            list.push(n.id);
            byDepth.set(d, list);
        }
        const maxDepth = byDepth.size ? Math.max(...byDepth.keys()) : 0;

        const bandW =
            MARGIN_X * 2 + (maxDepth + 1) * COL_W - (COL_W - NODE_W);

        // Wrap every label first: the wrap decides each node's height.
        const prepared = new Map();
        for (const n of sourceNodes) {
            const lines = wrapText(
                nodeLabel(n, deviceName?.(n)),
                NODE_W - 32,
                LABEL_FONT
            );
            prepared.set(n.id, {
                lines,
                height:
                    NODE_PAD_TOP +
                    (lines.length - 1) * LABEL_LINE_H +
                    NODE_PAD_BOTTOM,
            });
        }

        // Stack each depth column, remember the tallest, then centre them all.
        const columns = [];
        let contentH = 0;
        for (const [d, ids] of byDepth) {
            const placed = [];
            let y = 0;
            for (const id of ids) {
                placed.push({ id, y });
                y += prepared.get(id).height + ROW_GAP;
            }
            const colH = Math.max(y - ROW_GAP, 0);
            contentH = Math.max(contentH, colH);
            columns.push({ depth: d, placed, colH });
        }

        const titleLines = wrapText(
            automation.name ?? '',
            bandW - 48,
            BAND_TITLE_FONT
        );
        const titleH =
            TITLE_TOP + (titleLines.length - 1) * TITLE_LINE_H + TITLE_PAD;
        const bandH = titleH + contentH + BAND_PAD_BOTTOM;
        const bandY = cursorY;
        const nodeTop = bandY + titleH;

        const positioned = new Map();
        for (const col of columns) {
            const offset = (contentH - col.colH) / 2;
            for (const { id, y } of col.placed) {
                const explicit = sourceNodes.find(
                    (n) => n.id === id
                )?.position;
                positioned.set(id, {
                    x: explicit?.x ?? MARGIN_X + col.depth * COL_W,
                    y: explicit?.y ?? y + offset,
                });
            }
        }

        for (const n of sourceNodes) {
            const p = prepared.get(n.id);
            const pos = positioned.get(n.id) ?? { x: MARGIN_X, y: 0 };
            nodes.push({
                id: n.id,
                automationId: automation._id,
                kind: n.kind,
                label: p.lines.join(' '),
                lines: p.lines,
                color: KIND_COLORS[n.kind] ?? '#9E9E9E',
                x: pos.x,
                y: nodeTop + pos.y,
                w: NODE_W,
                h: p.height,
                padTop: NODE_PAD_TOP,
                lineH: LABEL_LINE_H,
                fontSize: LABEL_FONT,
            });
        }

        for (const e of edges ?? []) {
            const from = positioned.get(e.from);
            const to = positioned.get(e.to);
            if (!from || !to) continue;
            links.push({
                id: `${automation._id}:${e.from}>${e.to}`,
                automationId: automation._id,
                when: e.when ?? 'always',
                color: KIND_COLORS.trigger,
                d: edgePath(
                    from.x + NODE_W,
                    nodeTop + from.y + prepared.get(e.from).height / 2,
                    to.x,
                    nodeTop + to.y + prepared.get(e.to).height / 2
                ),
            });
        }

        bands.push({
            id: automation._id,
            name: automation.name,
            active: automation.active,
            x: 0,
            y: bandY,
            w: bandW,
            h: bandH,
            titleLines,
            titleTop: TITLE_TOP,
            titleLineH: TITLE_LINE_H,
        });

        cursorY += bandH + BAND_GAP;
        maxWidth = Math.max(maxWidth, bandW);
    }

    const width = Math.max(maxWidth, 400);
    const height = Math.max(cursorY - BAND_GAP, 200);

    return {
        bands,
        nodes,
        links,
        bounds: { minX: 0, minY: 0, maxX: width, maxY: height, width, height },
    };
}

