/**
 * Pure helpers of the cameras module: parsing an inbound vision event. No I/O —
 * the DB/API wiring lives in `events.ts` / `api.ts`, so the tests use these
 * directly. The mode table itself is `cameras/modes.ts`.
 */
import { VisionEvent, VisionEventKind } from '../types';

/** The event kinds a feed may report (the closed vocabulary). */
export const VISION_EVENT_KINDS: VisionEventKind[] = [
    'motion',
    'enter',
    'leave',
    'dwell',
    'appear',
    'disappear',
    'gesture',
];

/** Parse + normalize an inbound event body; null when unusable. */
export function visionEventFromBody(body: any): VisionEvent | null {
    if (!body || typeof body !== 'object') return null;
    const cameraId =
        typeof body.cameraId === 'string' ? body.cameraId.trim() : '';
    if (!cameraId) return null;

    const kind: VisionEventKind = VISION_EVENT_KINDS.includes(body.kind)
        ? body.kind
        : 'motion';

    return {
        at: Number.isFinite(body.at) ? Number(body.at) : Date.now(),
        cameraId,
        modes: Array.isArray(body.modes)
            ? body.modes.filter((m: unknown) => typeof m === 'string')
            : [],
        kind,
        classes: Array.isArray(body.classes)
            ? body.classes.filter((c: unknown) => typeof c === 'string')
            : [],
        trackId: Number.isFinite(body.trackId) ? Number(body.trackId) : undefined,
        score: Number.isFinite(body.score) ? Number(body.score) : undefined,
        dwellMs: Number.isFinite(body.dwellMs) ? Number(body.dwellMs) : undefined,
        keyframeUrl:
            typeof body.keyframeUrl === 'string' ? body.keyframeUrl : undefined,
        vlm:
            body.vlm && typeof body.vlm.text === 'string'
                ? {
                      tier: body.vlm.tier === 'heavy' ? 'heavy' : 'fast',
                      text: body.vlm.text,
                  }
                : undefined,
    };
}

/** Parse the `POST /api/vision/describe` body; null when it carries no image. */
export function describeRequestFromBody(
    body: any
): { image: string; prompt?: string } | null {
    const image = typeof body?.image === 'string' ? body.image.trim() : '';
    if (!image) return null;
    return {
        image,
        prompt: typeof body?.prompt === 'string' ? body.prompt : undefined,
    };
}

// --- Grocery (fridge / pantry) ------------------------------------------------

/**
 * Schema the grocery answer is constrained to: a closed object with free item
 * names. Names stay free (a fridge holds what it holds), but the shape does not,
 * so the model cannot answer with prose or a single string.
 */
export const GROCERY_ITEMS_SCHEMA = {
    type: 'object',
    properties: {
        items: { type: 'array', items: { type: 'string' } },
    },
    required: ['items'],
};

/** English prompt for listing the groceries a camera sees (never invents). */
export function buildGroceryPrompt(hint?: string): string {
    return [
        'You list the grocery items visible on this photo of a fridge or a pantry shelf.',
        'Reply ONLY with the JSON object: {"items": ["...", "..."]}.',
        'List only what you actually see. Never invent an item, and never add a quantity.',
        hint ? `Focus: ${hint}` : '',
    ]
        .filter(Boolean)
        .join('\n');
}

/**
 * Trimmed, de-duplicated item names from a grocery answer. Never invents: an
 * answer that is not `{ items: string[] }` yields nothing.
 */
export function groceryItemsFromAnswer(raw: unknown): string[] {
    const list = (raw as any)?.items;
    if (!Array.isArray(list)) return [];

    const seen = new Set<string>();
    const items: string[] = [];
    for (const value of list) {
        const name = typeof value === 'string' ? value.trim() : '';
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        items.push(name);
    }
    return items;
}

/**
 * A tiny model that loses its way repeats itself until its token budget runs out
 * — observed live on a webcam frame: "C'est une caméra qui est déjà déjà déjà …".
 * That is not an observation, so the escalation must treat it as no answer and
 * ask the heavy model instead.
 */
export function looksDegenerate(text: string): boolean {
    // Accents are folded so a repeated word compares equal however it is written
    // (`\p{L}`-style classes need the `u` flag, which this target rejects).
    const words = String(text ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9']+/)
        .filter(Boolean);
    // Too short to judge (a real sentence, or nothing).
    if (words.length < 12) return false;

    // 1. The same word four times in a row is already pathological.
    let run = 1;
    for (let i = 1; i < words.length; i++) {
        run = words[i] === words[i - 1] ? run + 1 : 1;
        if (run >= 4) return true;
    }

    // 2. Count the 3-word shingles. A description barely ever reuses its own
    //    phrases, while a model that lost its thread does nothing else:
    //    "C'est un film de l'animal, qui est enfant, et qui est enfant de
    //    l'animal. C'est un film de l'animal qui est enfant de l'animal."
    //    (captured live) is 13 distinct shingles out of 22.
    const counts = new Map<string, number>();
    let max = 0;
    for (let i = 0; i + 3 <= words.length; i++) {
        const key = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
        const seen = (counts.get(key) ?? 0) + 1;
        counts.set(key, seen);
        if (seen > max) max = seen;
    }

    const total = words.length - 2;
    if (max >= 4) return true;
    return total >= 8 && counts.size / total < 0.65;
}
