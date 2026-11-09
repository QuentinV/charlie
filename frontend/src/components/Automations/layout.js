// Pure geometry for the house graph.
//
// No React, no DOM. It turns the backend's `{ nodes, edges }` payload (see
// `nodejs-apis/src/automations/graph.ts`) into positioned boxes and routed arcs:
// left → right by longest-path rank, columns centred vertically. An arc whose
// target can reach back to its source is a **cycle** and bows outside, so the
// feedback loop the engine's cascade guards exist for is visible.

export const KIND_COLORS = {
    state: '#FF7043', // deep orange — a device state definition
    schedule: '#FFB300', // amber — a clock
    manual: '#90A4AE', // grey — run by hand
    event: '#26C6DA', // cyan — an action completed
    condition: '#B388FF', // violet — a gate
    action: '#4EC8F5', // blue — a natural-language action
    notify: '#4CD964', // green — a push notification
};

export const CYCLE_COLOR = '#FF5252';

export const NODE_METRICS = {
    width: 215,
    captionY: 18,
    padTop: 36,
    lineH: 15,
    labelFont: 12.5,
    subtitleGap: 16,
    subtitleFont: 9.5,
    radius: 12,
};

const COL_W = 300; // horizontal step between ranks
const ROW_GAP = 22;
const MARGIN = 32;
const MAX_LABEL_LINES = 4;

/**
 * Rough advance width of a string in a UI sans-serif. SVG offers no measurement
 * at layout time, so we estimate ~0.53em per glyph, a little more for caps and
 * digits, less for the narrow ones — good enough to wrap on.
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
 * whole line is hard-broken — so no character is ever dropped. Always returns at
 * least one line.
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
 * Longest-path rank per node, computed on the **acyclic** arcs only. Cyclic arcs
 * are excluded on purpose: a loop (state → action → that state) would otherwise
 * push its own rank up on every relaxation pass and stretch the picture.
 */
export function computeRanks(nodes, edges) {
    const ids = new Set((nodes ?? []).map((n) => n.id));
    const preds = new Map();
    for (const edge of edges ?? []) {
        if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
        const list = preds.get(edge.to) ?? [];
        list.push(edge.from);
        preds.set(edge.to, list);
    }

    const rank = new Map((nodes ?? []).map((n) => [n.id, 0]));
    for (let pass = 0; pass < (nodes?.length ?? 0) + 1; pass++) {
        let changed = false;
        for (const node of nodes ?? []) {
            let value = 0;
            for (const pred of preds.get(node.id) ?? []) {
                value = Math.max(value, (rank.get(pred) ?? 0) + 1);
            }
            if (rank.get(node.id) !== value) {
                rank.set(node.id, value);
                changed = true;
            }
        }
        if (!changed) break;
    }
    return rank;
}

/**
 * Order each column by the barycentre of its predecessors (a few sweeps), which
 * is what keeps arcs from crossing in a layered picture. Mutates `byRank`.
 */
export function orderRanks(byRank, edges) {
    const order = new Map();
    for (const ids of byRank.values()) {
        ids.forEach((id, i) => order.set(id, i));
    }

    const preds = new Map();
    for (const edge of edges ?? []) {
        const list = preds.get(edge.to) ?? [];
        list.push(edge.from);
        preds.set(edge.to, list);
    }

    const ranks = [...byRank.keys()].sort((a, b) => a - b);
    for (let sweep = 0; sweep < 4; sweep++) {
        for (const rank of ranks) {
            const ids = byRank.get(rank);
            const scored = ids.map((id) => {
                const values = (preds.get(id) ?? [])
                    .map((pred) => order.get(pred))
                    .filter((value) => value !== undefined);
                const bary = values.length
                    ? values.reduce((a, b) => a + b, 0) / values.length
                    : order.get(id) ?? 0;
                return { id, bary, tie: order.get(id) ?? 0 };
            });
            scored.sort((a, b) => a.bary - b.bary || a.tie - b.tie);
            scored.forEach((entry, i) => {
                order.set(entry.id, i);
                ids[i] = entry.id;
            });
        }
    }
    return byRank;
}

/**
 * A forward arc is a clean bezier; a cycle bows outside so it reads as a loop.
 * Returns the path plus the point at `t = 0.5`, where a transition label sits
 * (on the curve, never floating beside it).
 */
export function routeEdge({ x1, y1, x2, y2, back }) {
    let cx1;
    let cx2;
    let cy1 = y1;
    let cy2 = y2;
    if (!back) {
        const dx = Math.max(Math.abs(x2 - x1) * 0.5, 40);
        cx1 = x1 + dx;
        cx2 = x2 - dx;
    } else {
        const bow = 70 + Math.abs(y2 - y1) * 0.35;
        const direction = y2 >= y1 ? 1 : -1;
        cx1 = x1 + 130;
        cx2 = x2 - 130;
        cy1 = y1 + direction * bow;
        cy2 = y2 + direction * bow;
    }
    return {
        d: `M ${x1} ${y1} C ${cx1} ${cy1} ${cx2} ${cy2} ${x2} ${y2}`,
        midX: (x1 + 3 * cx1 + 3 * cx2 + x2) / 8,
        midY: (y1 + 3 * cy1 + 3 * cy2 + y2) / 8,
    };
}

const PAD_BOTTOM = 12;

/**
 * Lay the house graph out. Returns positioned nodes (`x/y/w/h/lines/subtitle/
 * color`) and routed edges (`d/x1/y1/x2/y2/color/dashed/cycle`), plus `bounds`
 * for the pan/zoom maths.
 */
export function layoutHouseGraph(nodes = [], edges = []) {
    // A self-loop cannot be routed to itself: drop it from the drawing.
    const drawn = (edges ?? []).filter(
        (edge) => edge.from && edge.to && edge.from !== edge.to
    );
    const rank = computeRanks(nodes, drawn.filter((edge) => !edge.cycle));

    const byRank = new Map();
    for (const node of nodes ?? []) {
        const value = rank.get(node.id) ?? 0;
        const list = byRank.get(value) ?? [];
        list.push(node.id);
        byRank.set(value, list);
    }
    orderRanks(byRank, drawn);

    // Size first: the wrap decides each node's height.
    const sized = new Map();
    for (const node of nodes ?? []) {
        const lines = wrapText(
            node.label ?? node.id,
            NODE_METRICS.width - 30,
            NODE_METRICS.labelFont
        ).slice(0, MAX_LABEL_LINES);
        const subtitle = node.subtitle ?? node.automationName ?? '';
        sized.set(node.id, {
            lines,
            subtitle,
            height:
                NODE_METRICS.padTop +
                (lines.length - 1) * NODE_METRICS.lineH +
                (subtitle ? NODE_METRICS.subtitleGap : 0) +
                PAD_BOTTOM,
        });
    }

    // Stack each column, remember the tallest, then centre them all.
    const columns = [];
    let contentH = 0;
    for (const value of [...byRank.keys()].sort((a, b) => a - b)) {
        const ids = byRank.get(value);
        let y = 0;
        const placed = [];
        for (const id of ids) {
            const size = sized.get(id);
            if (!size) continue;
            placed.push({ id, y });
            y += size.height + ROW_GAP;
        }
        const colH = Math.max(y - ROW_GAP, 0);
        contentH = Math.max(contentH, colH);
        columns.push({ rank: value, placed, colH });
    }

    const position = new Map();
    for (const column of columns) {
        const offset = (contentH - column.colH) / 2;
        for (const { id, y } of column.placed) {
            position.set(id, {
                x: MARGIN + column.rank * COL_W,
                y: MARGIN + y + offset,
            });
        }
    }

    const outNodes = (nodes ?? []).map((node) => {
        const size = sized.get(node.id);
        const point = position.get(node.id) ?? { x: MARGIN, y: MARGIN };
        return {
            ...node,
            x: point.x,
            y: point.y,
            w: NODE_METRICS.width,
            h: size?.height ?? 48,
            lines: size?.lines ?? [node.label ?? node.id],
            subtitle: size?.subtitle ?? '',
            color: KIND_COLORS[node.kind] ?? '#9E9E9E',
        };
    });
    const byId = new Map(outNodes.map((node) => [node.id, node]));

    const outEdges = [];
    for (const edge of drawn) {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) continue;
        const x1 = from.x + from.w;
        const y1 = from.y + from.h / 2;
        const x2 = to.x;
        const y2 = to.y + to.h / 2;
        const back = to.x <= from.x;
        const route = routeEdge({ x1, y1, x2, y2, back });
        outEdges.push({
            ...edge,
            x1,
            y1,
            x2,
            y2,
            back,
            d: route.d,
            // Where the transition label sits (on the curve, at t = 0.5).
            labelX: route.midX,
            labelY: route.midY,
            color: edge.cycle ? CYCLE_COLOR : from.color,
            dashed: edge.kind === 'effect',
        });
    }

    const width = outNodes.length
        ? Math.max(...outNodes.map((node) => node.x + node.w)) + MARGIN
        : 480;
    const height = contentH ? contentH + MARGIN * 2 : 240;

    return { nodes: outNodes, edges: outEdges, bounds: { width, height } };
}

/**
 * Fit a laid-out graph into a fixed-size viewport: scale down until the whole
 * picture fits (never up — 1 is the ceiling), then centre it.
 *
 * The group transform is `translate(tx ty) translate(cx cy) scale(s)
 * translate(-cx -cy)` with `cx = bounds.width / 2`, so `tx = vw / 2 - cx` maps
 * the content centre onto the viewport centre.
 */
export function fitView(bounds, viewport, padding = 16) {
    const width = bounds?.width ?? 0;
    const height = bounds?.height ?? 0;
    const vw = viewport?.width ?? 0;
    const vh = viewport?.height ?? 0;
    if (!vw || !vh || !width || !height) return { scale: 1, tx: 0, ty: 0 };
    return {
        scale: Math.min(
            1,
            (vw - padding * 2) / width,
            (vh - padding * 2) / height
        ),
        tx: vw / 2 - width / 2,
        ty: vh / 2 - height / 2,
    };
}

/**
 * The card filter: keep the arcs declared by (or observed for) one automation.
 * The shared state nodes come along because a kept arc touches them — which is
 * the whole point of the merged picture.
 */
export function filterGraph(graph, automationId) {
    if (!automationId) return graph ?? { nodes: [], edges: [] };

    const byId = new Map((graph.nodes ?? []).map((node) => [node.id, node]));
    const edges = (graph.edges ?? []).filter((edge) => {
        if (edge.automationId !== automationId) return false;
        // A listen arc points at another automation's action: only keep it when
        // that action is inside the filter too.
        if (edge.kind === 'listens') {
            return byId.get(edge.to)?.automationId === automationId;
        }
        return true;
    });

    const keep = new Set();
    for (const edge of edges) {
        keep.add(edge.from);
        keep.add(edge.to);
    }
    for (const node of graph.nodes ?? []) {
        if (node.automationId === automationId) keep.add(node.id);
    }

    return {
        nodes: (graph.nodes ?? []).filter((node) => keep.has(node.id)),
        edges,
    };
}


