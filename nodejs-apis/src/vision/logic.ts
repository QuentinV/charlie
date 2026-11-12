/**
 * Pure helpers of the vision module: the classifier schema and prompt, the
 * extraction prompt, the tolerant answer parsing. No I/O and no registry import
 * (the pipeline wires the modules in), so the tests use them directly and the
 * modules can use them back without a cycle.
 */
import type { VisionModule } from './modules/types';

/** Value returned by the classifier when no module applies. */
export const UNKNOWN_TYPE = 'unknown';

/** A recipe cannot take 30 h: above this the answer is a mistake, not a time. */
const MAX_DURATION_S = 24 * 60 * 60;

/** Trimmed non-empty string, or undefined. */
export function asString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const s = value.trim();
    return s ? s : undefined;
}

/** Finite number, or undefined (the model answers "6" as a string too). */
export function asNumber(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
        const n = Number(value.replace(',', '.'));
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}

/**
 * A positive amount, or undefined. `0` is the "the image does not say" marker of
 * the prompts, so it never becomes a quantity — and an absence of quantity is
 * what invalidates a unit (see the recipe module).
 */
export function positiveNumber(value: unknown): number | undefined {
    const n = asNumber(value);
    return n !== undefined && n > 0 ? n : undefined;
}

/** A duration in seconds: 0 when absent, negative or absurd. */
export function durationSeconds(value: unknown): number {
    const n = asNumber(value);
    if (n === undefined || n <= 0 || n > MAX_DURATION_S) return 0;
    return Math.round(n);
}

/**
 * JSON schema of the classifier answer: a closed enum of the document types, so
 * constrained decoding cannot produce a type Charlie does not implement.
 */
export function classifierSchema(moduleIds: string[]) {
    return {
        type: 'object',
        properties: {
            type: { type: 'string', enum: [...moduleIds, UNKNOWN_TYPE] },
        },
        required: ['type'],
    };
}

/**
 * English classifier prompt, built from the catalogue: one line per module
 * (`id: hint`) plus the `unknown` escape, which is what keeps a photo of a
 * screwdriver from being read as a receipt. Same shape as the tool list handed
 * to the agent — the model picks an id, it never invents one.
 */
export function buildDetectPrompt(
    modules: Pick<VisionModule, 'id' | 'hint'>[]
): string {
    return [
        'You classify a document for a home assistant, from a photo of it.',
        'Reply ONLY with the JSON object, no text around it: {"type": "<one of the allowed types>"}.',
        'Types:',
        ...modules.map((m) => `- ${m.id}: ${m.hint}`),
        '- ' +
            UNKNOWN_TYPE +
            ': anything else — a photo of an object, a person, a landscape, a screenshot, or a document you cannot read.',
    ].join('\n');
}

/**
 * Extraction prompt of a module: its own rules, then the JSON schema it must
 * fill. The schema is rendered from the module (never hand-written JSON in a
 * prompt string), which is what keeps instruction and grammar in sync.
 */
export function buildExtractPrompt(
    module: Pick<VisionModule, 'prompt' | 'schema'>
): string {
    return [
        module.prompt,
        '',
        'JSON schema:',
        JSON.stringify(module.schema, null, 2),
    ].join('\n');
}

/**
 * Tolerant read of a model answer: strict JSON first, then the first `{`…`}`
 * slice (a model sometimes wraps the object in prose or a code fence). Returns
 * undefined when nothing parses — the caller turns that into a failed scan.
 */
export function parseJsonAnswer(content?: string | null): unknown {
    const raw = typeof content === 'string' ? content.trim() : '';
    if (!raw) return undefined;

    const candidates = [raw];
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) candidates.push(fenced[1].trim());
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));

    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch {
            // try the next shape
        }
    }
    return undefined;
}

/**
 * The type read from a classifier answer: an allowed id, or `unknown` when the
 * answer is unusable or names something Charlie does not implement.
 */
export function answerType(raw: unknown, moduleIds: string[]): string {
    const value = asString((raw as any)?.type);
    if (!value) return UNKNOWN_TYPE;
    const folded = value.toLowerCase();
    return moduleIds.find((id) => id.toLowerCase() === folded) ?? UNKNOWN_TYPE;
}

