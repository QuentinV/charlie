// Deterministic radial "brain" layout for a memory profile.
// Pure functions only (no React / no DOM) so the geometry is easy to reason
// about and can be unit-tested later.

export const CATEGORY_COLORS = {
    preferences: '#FFB300',
    facts: '#4EC8F5',
    topics: '#B388FF',
    summary: '#4CD964',
};

const CORE_RADIUS = 48;
const CATEGORY_RADIUS = 24;
const LEAF_RADIUS = 7;
const RING_CATEGORY = 200;
const RING_LEAF = 372;

/** FNV-1a string hash -> uint32 (stable seed for the organic jitter). */
function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** Mulberry32 PRNG -> [0,1). */
function seededUnit(seed) {
    let t = (seed + 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Quadratic bezier with a perpendicular bend for an organic axon look. */
export function axonPath(x1, y1, x2, y2, bend = 0.16) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const ox = -(y2 - y1) * bend;
    const oy = (x2 - x1) * bend;
    return `M ${x1} ${y1} Q ${mx + ox} ${my + oy} ${x2} ${y2}`;
}

function makeBranch(key, label, leaves) {
    const color = CATEGORY_COLORS[key];
    return {
        id: `cat:${key}`,
        kind: 'category',
        color,
        label,
        children: leaves.map((l) => ({ ...l, kind: 'leaf', color })),
    };
}

/** Map a UserMemory profile to a `{ root, children[] }` brain tree. */
export function buildBrainTree(profile) {
    const branches = [];

    const prefs = Object.entries(profile?.preferences ?? {});
    if (prefs.length) {
        branches.push(
            makeBranch(
                'preferences',
                'Préférences',
                prefs.map(([k, v]) => ({
                    id: `pref:${k}`,
                    label: `${k}: ${v}`,
                }))
            )
        );
    }

    const facts = profile?.facts ?? [];
    if (facts.length) {
        branches.push(
            makeBranch(
                'facts',
                'Faits',
                facts.map((f, i) => ({ id: `fact:${i}`, label: f }))
            )
        );
    }

    const topics = Object.entries(profile?.topics ?? {});
    if (topics.length) {
        branches.push(
            makeBranch(
                'topics',
                'Sujets',
                topics.map(([k, v]) => ({
                    id: `topic:${k}`,
                    label: `${k}: ${v}`,
                }))
            )
        );
    }

    if (profile?.summary) {
        branches.push(
            makeBranch('summary', 'Résumé', [
                { id: 'summary', label: profile.summary },
            ])
        );
    }

    return {
        id: 'root',
        kind: 'root',
        color: '#FFD700',
        label: profile?.user ?? 'unknown',
        children: branches,
    };
}

function computeBounds(nodes) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
        const labelWidth =
            n.kind === 'leaf' ? Math.min(n.label?.length ?? 0, 28) * 6.2 : 0;
        minX = Math.min(minX, n.x - n.r);
        maxX = Math.max(maxX, n.x + n.r + labelWidth);
        minY = Math.min(minY, n.y - n.r);
        maxY = Math.max(maxY, n.y + n.r);
    }
    if (!Number.isFinite(minX)) {
        return {
            minX: -200,
            minY: -200,
            maxX: 200,
            maxY: 200,
            width: 400,
            height: 400,
        };
    }
    const pad = 70;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Compute node + link geometry for the radial brain.
 * @param {any} root tree from buildBrainTree()
 * @param {{ collapsed?: Set<string> }} options
 */
export function layoutBrain(root, options = {}) {
    const collapsed = options.collapsed ?? new Set();
    const nodes = [];
    const links = [];

    nodes.push({
        id: root.id,
        kind: 'root',
        label: root.label,
        color: root.color,
        x: 0,
        y: 0,
        r: CORE_RADIUS,
    });

    const branches = root.children ?? [];
    const n = Math.max(branches.length, 1);
    const baseAngle = -Math.PI / 2;

    branches.forEach((branch, i) => {
        const angle = baseAngle + (i * 2 * Math.PI) / n;
        const bx = Math.cos(angle) * RING_CATEGORY;
        const by = Math.sin(angle) * RING_CATEGORY;
        const isCollapsed = collapsed.has(branch.id);
        const children = isCollapsed ? [] : branch.children ?? [];

        nodes.push({
            id: branch.id,
            kind: 'category',
            label: branch.label,
            color: branch.color,
            x: bx,
            y: by,
            r: CATEGORY_RADIUS,
            parentId: root.id,
            collapsed: isCollapsed,
            childCount: (branch.children ?? []).length,
        });
        links.push({
            id: `l:${root.id}>${branch.id}`,
            color: branch.color,
            d: axonPath(0, 0, bx, by, 0.16),
        });

        const m = children.length;
        if (!m) return;
        const spread = Math.min(((2 * Math.PI) / n) * 0.72, 1.0);
        children.forEach((leaf, j) => {
            const t = m === 1 ? 0 : j / (m - 1) - 0.5;
            const la = angle + t * spread;
            const rl =
                RING_LEAF + (seededUnit(hashString(leaf.id)) - 0.5) * 30;
            const lx = Math.cos(la) * rl;
            const ly = Math.sin(la) * rl;
            nodes.push({
                id: leaf.id,
                kind: 'leaf',
                label: leaf.label,
                color: leaf.color,
                x: lx,
                y: ly,
                r: LEAF_RADIUS,
                parentId: branch.id,
            });
            links.push({
                id: `l:${branch.id}>${leaf.id}`,
                color: leaf.color,
                d: axonPath(bx, by, lx, ly, 0.12),
            });
        });
    });

    return { nodes, links, bounds: computeBounds(nodes) };
}

export function truncate(text, max = 28) {
    const t = String(text ?? '');
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
