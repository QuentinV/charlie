/**
 * Recipe module: a handwritten or printed cooking recipe → title, yield, times,
 * ingredients and steps, with the units of the household shopping list.
 *
 * Captured on the shipped model (Qwen3-VL-4B Q4_K_M, CPU) against a real
 * handwritten `recette-de-crepe` photo: 6 ingredients, closed-enum units, steps
 * transcribed. Two measured habits are handled in `parse`, never in the prompt
 * alone:
 * - a duration key can be missing (`cook_time_s` is not required) → default 0;
 * - a bare ingredient ("du beurre pour la cuisson") came back as
 *   `quantity: 0, unit: "piece"` — a made-up unit. A unit is therefore kept only
 *   when a positive quantity backs it, and a unit outside the household
 *   vocabulary is dropped rather than stored as junk.
 */
import { z } from 'zod';
import {
    UNIT_ENUM,
    foldName,
    mergeItems,
    normalizeUnit,
    unitAliases,
} from '../../shopping/items.logic';
import { getActiveList, newItem, replaceItems } from '../../shopping/list';
import { asString, durationSeconds, positiveNumber } from '../logic';
import { VisionModule } from './types';

/**
 * Units a recipe uses that a grocery list never sees. ASCII tokens like
 * `UNIT_ENUM` (safe for the JSON-schema grammar), rendered by
 * `RECIPE_UNIT_LABELS`.
 */
export const RECIPE_EXTRA_UNITS = [
    'cuillere_a_soupe',
    'cuillere_a_cafe',
    'pincee',
    'gousse',
    'verre',
];

/** Units the recipe model is allowed to emit (closed enum). */
export const RECIPE_UNITS = [...UNIT_ENUM, ...RECIPE_EXTRA_UNITS];

/** Displayed form of the recipe-only tokens. */
export const RECIPE_UNIT_LABELS: { [token: string]: string } = {
    cuillere_a_soupe: 'c. à soupe',
    cuillere_a_cafe: 'c. à café',
    pincee: 'pincée',
    gousse: 'gousse',
    verre: 'verre',
};

export const RECIPE_SCHEMA = {
    type: 'object',
    properties: {
        title: { type: 'string' },
        estimatedFor: {
            type: 'object',
            properties: {
                persons: { type: 'number' },
                name: { type: 'string' },
                quantity: { type: 'number' },
            },
            required: ['persons', 'name', 'quantity'],
        },
        prep_time_s: { type: 'number' },
        cook_time_s: { type: 'number' },
        ingredients: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    quantity: { type: 'number' },
                    unit: { type: 'string', enum: RECIPE_UNITS },
                    note: { type: 'string' },
                },
                required: ['name'],
            },
        },
        steps: { type: 'array', items: { type: 'string' } },
    },
    // `cook_time_s` and `steps` are deliberately not required: measured, the
    // model omits what the image does not answer, which is the behaviour wanted
    // (a forced key would invite an invented number).
    required: ['title', 'ingredients'],
};

export const RECIPE_PROMPT = [
    'You extract a cooking recipe from a photo of it (handwritten, printed or a web page).',
    'Reply ONLY with the JSON object, no text around it.',
    'Rules:',
    '- Never invent an ingredient, a quantity, a time or a step that is not written on the image.',
    '- title: the recipe name as written, without a "Recipe" prefix.',
    '- estimatedFor.persons: how many people (or portions) the recipe is for; 0 when the image does not say.',
    '- estimatedFor.name: what the recipe yields (e.g. "crepes"); an empty string when the image does not say.',
    '- estimatedFor.quantity: how many items it yields; 0 when the image does not say.',
    '- prep_time_s and cook_time_s: SECONDS; 0 when the image does not say. Convert "1 h 30" to 5400.',
    '- ingredients: one entry per ingredient, in the order of the image; the name alone, in the singular, without the quantity.',
    '- ingredients[].quantity: a number; 0 when the image does not give one.',
    '- ingredients[].unit: ONLY from the allowed list, and only when the image gives one. Never reuse the ingredient name as a unit, and never use a unit for an ingredient without a quantity.',
    '- ingredients[].note: a precision written next to the ingredient ("pour la cuisson"); otherwise omit it.',
    '- steps: one string per instruction, in the order of the image, without their number.',
].join('\n');

/**
 * A number the model may have written as a string: constrained decoding emits a
 * real number, but an answer that drifts from the schema does not, and
 * `asNumber` reads both.
 */
const looseNumber = z.union([z.number(), z.string()]);

/** Tolerant validation of the model answer (unknown fields are ignored). */
const RecipeAnswer = z.object({
    title: z.string(),
    estimatedFor: z
        .object({
            persons: looseNumber.nullable().optional(),
            name: z.string().nullable().optional(),
            quantity: looseNumber.nullable().optional(),
        })
        .nullable()
        .optional(),
    prep_time_s: looseNumber.nullable().optional(),
    cook_time_s: looseNumber.nullable().optional(),
    ingredients: z.array(
        z.object({
            name: z.string(),
            quantity: looseNumber.nullable().optional(),
            unit: z.string().nullable().optional(),
            note: z.string().nullable().optional(),
        })
    ),
    steps: z.array(z.string()).nullable().optional(),
});

export interface RecipeIngredient {
    name: string;
    /** Absent when the image does not give an amount. */
    quantity?: number;
    /** Displayed unit ("g", "c. à soupe"), only with a quantity. */
    unit?: string;
    note?: string;
}

export interface RecipeEstimatedFor {
    /** 0 when the image does not say. */
    persons: number;
    name?: string;
    /** 0 when the image does not say. */
    quantity: number;
}

export interface Recipe {
    title: string;
    /** Absent when the image gives neither a number of people nor a yield. */
    estimatedFor?: RecipeEstimatedFor;
    /** Seconds, 0 when the image does not say. */
    prepTimeS: number;
    cookTimeS: number;
    ingredients: RecipeIngredient[];
    steps: string[];
}

/**
 * Canonical, displayed form of a unit: a recipe token ("cuillere_a_soupe" → "c.
 * à soupe"), or a form the household vocabulary recognizes ("gr" → "g",
 * "litre" → "L" — what a free-text answer produces). Anything else is dropped:
 * a unit nobody knows is worse than no unit at all.
 */
export function recipeUnitLabel(unit?: unknown): string | undefined {
    const raw = asString(unit);
    if (!raw) return undefined;

    const folded = foldName(raw);
    const token = RECIPE_UNITS.find((u) => u === raw || foldName(u) === folded);
    if (token) return RECIPE_UNIT_LABELS[token] ?? normalizeUnit(token);

    const canonical = normalizeUnit(raw);
    return canonical && unitAliases(canonical).length ? canonical : undefined;
}

/** The recipe data of a parsed answer, or null when it is unusable. */
function toRecipe(answer: z.infer<typeof RecipeAnswer>): Recipe | null {
    const title = asString(answer.title);
    if (!title) return null;

    const ingredients: RecipeIngredient[] = [];
    for (const raw of answer.ingredients ?? []) {
        const name = asString(raw.name);
        if (!name) continue;

        const quantity = positiveNumber(raw.quantity);
        // No quantity on the image means no unit either: measured, the model
        // filled a bare "beurre pour la cuisson" with `0 / piece`.
        const unit = quantity ? recipeUnitLabel(raw.unit) : undefined;
        const note = asString(raw.note);

        ingredients.push({
            name,
            ...(quantity ? { quantity } : {}),
            ...(unit ? { unit } : {}),
            ...(note ? { note } : {}),
        });
    }

    if (!ingredients.length) return null;

    const persons = positiveNumber(answer.estimatedFor?.persons) ?? 0;
    const yieldQuantity = positiveNumber(answer.estimatedFor?.quantity) ?? 0;
    const yieldName = asString(answer.estimatedFor?.name);
    const estimatedFor: RecipeEstimatedFor | undefined =
        persons || yieldQuantity
            ? {
                  persons,
                  quantity: yieldQuantity,
                  ...(yieldName ? { name: yieldName } : {}),
              }
            : undefined;

    return {
        title,
        ...(estimatedFor ? { estimatedFor } : {}),
        prepTimeS: durationSeconds(answer.prep_time_s),
        cookTimeS: durationSeconds(answer.cook_time_s),
        ingredients,
        steps: (answer.steps ?? [])
            .map((s) => asString(s))
            .filter((s): s is string => !!s),
    };
}

/** "12 min" / "1 h 30" — spoken by TTS and shown in the list rows. */
function humanDuration(seconds: number): string {
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest}` : `${hours} h`;
}

const recipe: VisionModule<Recipe> = {
    id: 'recipe',
    label: 'Recette',
    hint: 'A cooking recipe: a list of ingredients and preparation steps, handwritten, printed or photographed from a screen.',
    schema: RECIPE_SCHEMA,
    prompt: RECIPE_PROMPT,
    // A whole recipe is long: room for the ingredient list and the steps
    // (measured: ~400 tokens for a 6-ingredient crêpe recipe).
    maxTokens: 700,
    parse(raw) {
        const answer = RecipeAnswer.safeParse(raw);
        return answer.success ? toRecipe(answer.data) : null;
    },
    summarize(data) {
        const parts = [
            data.estimatedFor?.persons
                ? `Recette « ${data.title} » pour ${data.estimatedFor.persons} personnes`
                : `Recette « ${data.title} »`,
            `${data.ingredients.length} ingrédients`,
        ];
        if (data.steps.length) parts.push(`${data.steps.length} étapes`);
        if (data.prepTimeS) {
            parts.push(`${humanDuration(data.prepTimeS)} de préparation`);
        }
        return parts.join(', ') + '.';
    },
    actions: [
        {
            id: 'add-to-shopping',
            label: 'Ajouter aux courses',
            /**
             * The household merge (`foldName` + unit equality → quantities
             * summed, a line asked again goes back to "to buy") so an ingredient
             * already on the list is completed instead of duplicated — the same
             * deterministic folding the restructurer applies to spoken requests.
             */
            async run(data, ctx) {
                const items = data.ingredients.map((i) =>
                    newItem({
                        name: i.name,
                        quantity: i.quantity,
                        unit: i.unit,
                        note: i.note,
                        user: ctx?.user,
                    })
                );
                const list = await getActiveList();
                await replaceItems(mergeItems(list.items ?? [], items));
                return `Added ${items.length} ingredient(s) from "${data.title}" to the shopping list.`;
            },
        },
    ],
};

export default recipe;
