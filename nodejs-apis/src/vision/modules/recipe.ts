/**
 * Recipe module: a handwritten or printed cooking recipe → title, yield, times,
 * ingredients and steps.
 *
 * The recipe **shape and vocabulary** belong to the cooking skill
 * (`skills/recipes/recipe.ts`): a photographed recipe and a page imported from
 * Marmiton must produce the same record, render in the same panel and merge into
 * the shopping list the same way, so sharing them here would be the one thing
 * that lets the two drift apart. This module keeps only what is vision-specific:
 * the JSON schema handed to the grammar, the extraction prompt and its tolerance
 * rules (`parse`).
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
import { saveScannedRecipe } from '../../skills/recipes';
import {
    RECIPE_UNITS,
    recipeUnitLabel,
    summarizeRecipe,
} from '../../skills/recipes/recipe';
import { Recipe, RecipeIngredient } from '../../types';
import { asString, durationSeconds, positiveNumber } from '../logic';
import { VisionModule } from './types';

// The vocabulary is this document type's public surface (the schema below is
// built from it, and the tests read it here) — it just lives with the skill.
export {
    RECIPE_EXTRA_UNITS,
    RECIPE_UNIT_LABELS,
    RECIPE_UNITS,
    recipeUnitLabel,
} from '../../skills/recipes/recipe';
export type {
    Recipe,
    RecipeEstimatedFor,
    RecipeIngredient,
} from '../../types';

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
    const estimatedFor =
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
    // Shared with the imported web recipes: one French sentence, one shape.
    summarize(data) {
        return summarizeRecipe(data);
    },
    actions: [
        {
            id: 'save-to-recipes',
            label: 'Ajouter aux recettes',
            /**
             * A scanned document is filed in the household's recipe library —
             * the same collection an imported page lands in, so its ingredients
             * reach the shopping list from the recipe (one place for that
             * gesture, whatever the source of the recipe). `ctx.scanId` is the
             * identity: running the action again updates the same record.
             */
            async run(data, ctx) {
                const record = await saveScannedRecipe(data, {
                    scanId: ctx?.scanId,
                    user: ctx?.user,
                });
                return `Saved "${record.recipe.title}" in the household recipes.`;
            },
        },
    ],
};

export default recipe;