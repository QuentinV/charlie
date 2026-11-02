/**
 * Background restructurer of the shopping list.
 *
 * Raw user requests (voice, chat, free text) pile up in the active list; a few
 * seconds after the last one, a small local model (router-served
 * `LLM_SHOPPING_MODEL`, Qwen3-1.7B by default) turns them into structured
 * items — names, quantities, units and aisles — with schema-constrained JSON
 * output. A failure never loses a request: the raw entries stay pending and the
 * UI can retry (or apply the deterministic fallback parser).
 */
import { z } from 'zod';
import { req, shoppingHost, shoppingModel } from '../ai/llm';
import { log } from '../manager/services/activities';
import { settings } from '../manager/services/settings';
import { ShoppingItem } from '../types';
import {
    dedupeItems,
    fallbackItems,
    foldName,
    formatQuantity,
    GROCERY_CATEGORIES,
    isGroceryCategory,
    mergeItems,
    nameBackedByTexts,
    normalizeUnit,
    ParsedItem,
    parseChunk,
    parseQuantity,
    sanitizeRequestText,
    splitChunks,
    UNIT_ENUM,
    unitContradictsName,
    unitMentionedInTexts,
} from './items.logic';
import {
    commitRestructure,
    getActiveList,
    getPendingRequests,
    newItem,
    setProcessing,
} from './list';

/** Wait after the last added request before structuring the list. */
export const DEFAULT_RESTRUCTURE_DELAY_MS = 4000;

/**
 * JSON schema handed to llama.cpp (`response_format: json_schema`). `unit` and
 * `category` are closed enums: constrained decoding then makes an invented unit
 * ("en", "boulet", "bouche") impossible to emit, not merely unlikely.
 */
export const SHOPPING_ITEMS_SCHEMA = {
    type: 'object',
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    quantity: { type: 'number' },
                    unit: { type: 'string', enum: UNIT_ENUM },
                    category: { type: 'string', enum: GROCERY_CATEGORIES },
                    note: { type: 'string' },
                },
                required: ['name'],
            },
        },
    },
    required: ['items'],
};

/** Tolerant validation of the model answer (extra/unknown fields are ignored). */
const LlmAnswer = z.object({
    items: z.array(
        z.object({
            name: z.string(),
            quantity: z.number().nullable().optional(),
            unit: z.string().nullable().optional(),
            category: z.string().nullable().optional(),
            note: z.string().nullable().optional(),
        })
    ),
});

export const RESTRUCTURE_PROMPT = [
    'You turn raw grocery requests into a structured shopping list.',
    'Reply ONLY with the JSON object, no text around it:',
    '{"items": [{"name", "quantity", "unit", "category", "note"}]}.',
    'Rules:',
    '- Never invent an item that is not in the requests.',
    '- name: the item alone, in the SINGULAR, without the quantity and without a',
    '  container word ("5 baguettes de pain" -> name "baguette de pain").',
    '- quantity: a number, 1 when the user does not say it.',
    '- unit: ONLY when the user says a unit himself: ' +
        UNIT_ENUM.join(', ') +
        '. An item counted one by one (baguette, pomme, oeuf, yaourt, steak) has NO',
    '  unit at all: never guess one, and never reuse the item name as a unit.',
    '- Never convert a unit into a quantity: "une douzaine d oeufs" is quantity 1',
    '  with unit "douzaine", NOT quantity 12.',
    '- category: one of ' + GROCERY_CATEGORIES.join(', ') + '.',
    '- note: only a useful precision (brand, cut, fat content), otherwise omit it.',
    '- One entry per distinct item; sum the quantities when the same item is asked twice.',
    'Examples:',
    '- "5 baguettes de pain" -> {"name": "baguette de pain", "quantity": 5, "category": "boulangerie"}',
    '- "une douzaine d oeufs" -> {"name": "oeuf", "quantity": 1, "unit": "douzaine", "category": "cremerie"}',
    '- "2 litres de lait" -> {"name": "lait", "quantity": 2, "unit": "L", "category": "cremerie"}',
    '- "des pommes" -> {"name": "pomme", "quantity": 1, "category": "fruits-legumes"}',
    '- "du beurre demi-sel" -> {"name": "beurre demi-sel", "quantity": 1, "category": "cremerie"}',
].join('\n');

/** The shopping feature is on unless explicitly disabled in the settings. */
export function shoppingEnabled(): boolean {
    return settings.shopping?.enabled !== false;
}

/** Delay before structuring, from the settings (or the environment). */
export function restructureDelayMs(): number {
    const fromSettings = Number(settings.shopping?.restructureDelayMs);
    if (Number.isFinite(fromSettings) && fromSettings > 0) {
        return fromSettings;
    }
    const fromEnv = Number(process.env.SHOPPING_RESTRUCTURE_DELAY_MS);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
    return DEFAULT_RESTRUCTURE_DELAY_MS;
}

let running = false;
const timers: { [key: string]: ReturnType<typeof setTimeout> } = {};

/**
 * Plan a structuring run shortly after the last request: burst additions from
 * a conversation ("ajoute du lait" ... "et du pain") cost one single run.
 */
export function scheduleRestructure(scope = 'household'): void {
    if (!shoppingEnabled()) return;
    clearTimeout(timers[scope]);
    timers[scope] = setTimeout(() => {
        void restructure();
    }, restructureDelayMs());
    // Do not keep the process alive just for a pending structuring run.
    timers[scope].unref?.();
}

export interface RestructureResult {
    status: 'done' | 'empty' | 'busy' | 'failed';
    /** Number of items produced by the run. */
    added?: number;
    error?: string;
}

/**
 * Turn the pending raw requests into items. Runs one at a time: a call while a
 * run is in flight re-schedules itself instead of racing it.
 */
export async function restructure(options?: {
    force?: boolean;
}): Promise<RestructureResult> {
    if (!shoppingEnabled() && !options?.force) return { status: 'empty' };

    const pending = await getPendingRequests();
    if (!pending.length) return { status: 'empty' };

    if (running) {
        scheduleRestructure();
        return { status: 'busy' };
    }

    running = true;
    await setProcessing('running');
    try {
        const list = await getActiveList();
        const parsed = await extractItems(pending.map((r) => r.text));
        const user = pending.find((r) => r.user)?.user;
        const items = toItems(parsed, user);

        const merged = mergeItems(list.items ?? [], items);
        // The list heals itself: rows that only differ by plural or by a unit
        // the user never said (structured before this rule existed) collapse
        // here, quantities summed.
        const deduped = dedupeItems(merged);
        const collapsed = merged.filter(
            (m) => !deduped.some((d) => d.id === m.id)
        );

        // Items, consumed requests and state move in a single write.
        await commitRestructure({
            items: deduped,
            rawIds: pending.map((r) => r.id),
        });

        if (collapsed.length) {
            log(
                'shopping',
                `Merged ${collapsed.length} duplicate row(s): ${collapsed
                    .map((c) => `${c.name} (${formatQuantity(c) || 'x1'})`)
                    .join(', ')}`
            );
        }

        log(
            'shopping',
            `Structured ${pending.length} request(s) into ${items.length} item(s)`
        );
        return { status: 'done', added: items.length };
    } catch (e) {
        const message = (e as any)?.message ?? String(e);
        // The requests stay pending: the UI offers a retry and a manual apply.
        await setProcessing('failed', message);
        log('shopping', 'Structuring failed', { data: { error: message } });
        return { status: 'failed', error: message };
    } finally {
        running = false;
    }
}

/**
 * Deterministic parser used when the model is unavailable (or the user does not
 * want to wait): applies the pending requests as they are.
 */
export async function applyFallback(): Promise<RestructureResult> {
    const pending = await getPendingRequests();
    if (!pending.length) return { status: 'empty' };

    const list = await getActiveList();
    const parsed: ParsedItem[] = pending.flatMap((r) =>
        fallbackItems([r.text]).map((i) => ({ ...i, user: r.user }))
    );
    const items = toItems(parsed, pending.find((r) => r.user)?.user);

    await commitRestructure({
        items: dedupeItems(mergeItems(list.items ?? [], items)),
        rawIds: pending.map((r) => r.id),
    });

    log('shopping', `Applied ${pending.length} request(s) verbatim`);
    return { status: 'done', added: items.length };
}

/**
 * Boot recovery: a restart during a structuring run leaves requests pending, so
 * plan a new run. Safe to call when everything is already processed.
 */
export async function resumePending(): Promise<void> {
    if (!shoppingEnabled()) return;
    const pending = await getPendingRequests();
    if (!pending.length) return;
    log('shopping', `Resuming ${pending.length} pending request(s)`);
    scheduleRestructure();
}

/** Render the requests for the model: the new request lines only. */
function renderRequest(texts: string[]): string {
    return [
        'Requests to structure:',
        ...texts.map((t) => `- ${sanitizeRequestText(t)}`),
    ].join('\n');
}

/** Tolerate a fenced answer: some models wrap JSON in ```json ... ```. */
export function parseLlmContent(content: string): unknown {
    const trimmed = (content ?? '').trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return JSON.parse(fenced ? fenced[1] : trimmed);
}

/**
 * Deterministic reading of the requests, keyed by folded item name: what the
 * user literally said ("une douzaine d oeufs" → quantity 1 + unit douzaine).
 * Used as ground truth for the number/unit, which is where the small model
 * drifts (it happily converts "douzaine" into 12 and keeps both).
 */
function spokenByParsedName(texts: string[]): Map<string, ParsedItem> {
    const byName = new Map<string, ParsedItem>();
    for (const text of texts ?? []) {
        for (const chunk of splitChunks(sanitizeRequestText(text))) {
            const parsed = parseChunk(chunk);
            if (parsed) byName.set(foldName(parsed.name), parsed);
        }
    }
    return byName;
}

/** Ask the small model to structure the texts (JSON-schema constrained). */
async function extractItems(texts: string[]): Promise<ParsedItem[]> {
    const response = await req(
        {
            messages: [
                { role: 'system', content: RESTRUCTURE_PROMPT },
                { role: 'user', content: renderRequest(texts) },
            ],
            tools: [],
            model: shoppingModel(),
            // Structuring is extraction: greedy decoding, bounded answer.
            temperature: 0,
            max_tokens: 256,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'shopping_items',
                    schema: SHOPPING_ITEMS_SCHEMA,
                },
            },
        },
        shoppingHost()
    );

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('empty answer from the structuring model');
    }

    let answer: z.infer<typeof LlmAnswer>;
    try {
        answer = LlmAnswer.parse(parseLlmContent(content));
    } catch {
        throw new Error('the structuring model did not return an item list');
    }

    return mapModelItems(answer.items, texts);
}

/** One item as the model returned it (see `LlmAnswer`). */
type RawModelItem = z.infer<typeof LlmAnswer>['items'][number];

/**
 * Map the model's answer to parsed items. Evidence beats the model's guess
 * twice over: a unit the user never said (or one that is merely the item name)
 * is dropped, and when the request itself parses cleanly, the number and unit
 * the user actually said win over the model's arithmetic.
 */
export function mapModelItems(
    rawItems: RawModelItem[],
    texts: string[]
): ParsedItem[] {
    const spoken = spokenByParsedName(texts);
    const kept: ParsedItem[] = [];

    for (const i of rawItems ?? []) {
        const name = (i.name ?? '').trim();
        if (!name) continue;

        // An item the user did not ask for here — typically one the model
        // echoed back from its context — cannot be traced to these requests:
        // dropped, so it can never be merged into (and increment) a row.
        if (!nameBackedByTexts(name, texts)) {
            log('shopping', `Ignored an item that was not asked for: ${name}`);
            continue;
        }

        const candidate = normalizeUnit(i.unit);
        const fromText = spoken.get(foldName(name));
        const unit =
            fromText?.unit ??
            (candidate &&
            unitMentionedInTexts(candidate, texts) &&
            !unitContradictsName(candidate, name)
                ? candidate
                : undefined);

        kept.push({
            name,
            quantity: fromText ? fromText.quantity : parseQuantity(i.quantity),
            unit,
            category: isGroceryCategory(i.category) ? i.category : undefined,
            note: i.note?.trim() || undefined,
        });
    }

    return kept;
}

/** Full items (id, status, dates) from a parsed answer. */
function toItems(parsed: ParsedItem[], user?: string): ShoppingItem[] {
    const at = Date.now();
    return (parsed ?? [])
        .filter((p) => !!p?.name?.trim())
        .map((p) =>
            newItem({ ...p, name: p.name.trim(), user: p.user ?? user }, at)
        );
}
