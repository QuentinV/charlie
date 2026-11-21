/**
 * The recipe domain, shared by the two entry points of the cooking skill:
 *
 * - a **photo** read by the vision pipeline (`vision/modules/recipe.ts`),
 * - a **page** imported from Marmiton (`skills/recipes/marmiton.ts`).
 *
 * A recipe is one shape (`Recipe` in `types.ts`), one unit vocabulary, one
 * French summary and one shopping merge. That is what makes "the same structure
 * as a scanned recipe" a type-level fact instead of a convention: the tab, the
 * voice answers and the shopping list cannot tell the two sources apart.
 *
 * This file owns no I/O beyond the shopping list merge, and no site knowledge.
 */
import {
    Recipe,
    RecipeEstimatedFor,
    RecipeIngredient,
    RecipeRating,
} from '../../types';
import {
    UNIT_ENUM,
    foldName,
    mergeItems,
    normalizeUnit,
    unitAliases,
} from '../shopping/items.logic';
import { getActiveList, newItem, replaceItems } from '../shopping/list';

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

/** Units the recipe extraction model is allowed to emit (closed enum). */
export const RECIPE_UNITS = [...UNIT_ENUM, ...RECIPE_EXTRA_UNITS];

/** Displayed form of the recipe-only tokens. */
export const RECIPE_UNIT_LABELS: { [token: string]: string } = {
    cuillere_a_soupe: 'c. à soupe',
    cuillere_a_cafe: 'c. à café',
    pincee: 'pincée',
    gousse: 'gousse',
    verre: 'verre',
};

/** Trimmed non-empty string, or undefined. */
function text(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const s = value.trim();
    return s ? s : undefined;
}

/**
 * Canonical, displayed form of a unit: a recipe token ("cuillere_a_soupe" → "c.
 * à soupe"), or a form the household vocabulary recognizes ("gr" → "g",
 * "litre" → "L" — what a free-text answer produces). Anything else is dropped:
 * a unit nobody knows is worse than no unit at all.
 */
export function recipeUnitLabel(unit?: unknown): string | undefined {
    const raw = text(unit);
    if (!raw) return undefined;

    const folded = foldName(raw);
    const token = RECIPE_UNITS.find((u) => u === raw || foldName(u) === folded);
    if (token) return RECIPE_UNIT_LABELS[token] ?? normalizeUnit(token);

    const canonical = normalizeUnit(raw);
    return canonical && unitAliases(canonical).length ? canonical : undefined;
}

/** "12 min" / "1 h 30" — spoken by TTS and shown in the list rows. */
export function humanDuration(seconds: number): string {
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest}` : `${hours} h`;
}

/**
 * French one-liner of a recipe: what the voice says and what a list row shows.
 * The rating is appended when the source has one (a web page), because it is
 * how the household chooses between two candidates.
 */
export function summarizeRecipe(
    data: Recipe,
    rating?: RecipeRating
): string {
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
    let summary = parts.join(', ') + '.';
    if (rating?.value) {
        const value = String(rating.value).replace('.', ',');
        summary += rating.count
            ? ` Notée ${value}/5 (${rating.count} avis).`
            : ` Notée ${value}/5.`;
    }
    return summary;
}

/**
 * Merge a recipe's ingredients into the household shopping list.
 *
 * The household merge (`foldName` + unit equality → quantities summed, a line
 * asked again goes back to "to buy") so an ingredient already on the list is
 * completed instead of duplicated — the same deterministic folding the
 * restructurer applies to spoken requests. Returns how many lines were added.
 */
export async function addRecipeIngredients(
    data: Recipe,
    user?: string
): Promise<number> {
    const items = (data.ingredients ?? []).map((i: RecipeIngredient) =>
        newItem({
            name: i.name,
            quantity: i.quantity,
            unit: i.unit,
            note: i.note,
            user,
        })
    );
    if (!items.length) return 0;

    const list = await getActiveList();
    await replaceItems(mergeItems(list.items ?? [], items));
    return items.length;
}

/** The yield fields of a recipe, or undefined when it says nothing. */
export function estimatedForOf(
    persons: number,
    quantity: number,
    name?: string
): RecipeEstimatedFor | undefined {
    if (!persons && !quantity) return undefined;
    return { persons, quantity, ...(name ? { name } : {}) };
}