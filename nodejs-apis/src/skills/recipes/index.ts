/**
 * The cooking skill: search Marmiton, import a recipe, keep a household library
 * and put its ingredients on the shopping list.
 *
 * The public surface is the same for every caller — REST (`api.ts`), the agent
 * (`tools/mcp/impl/recipes.ts`) and the voice (`tools/actions/impl/recipes.ts`):
 * nothing here decides how a request arrived, and no caller talks to the site.
 *
 * A recipe is **one shape** (`Recipe` in `types.ts`): an imported page and a
 * scanned photo land in the same collection, render in the same panel and merge
 * into the shopping list through the same deterministic fold
 * (`skills/recipes/recipe.ts`).
 */
import { Recipe, RecipeRecord } from '../../types';
import { log } from '../../manager/services/activities';
import { foldName } from '../shopping/items.logic';
import {
    MAX_CANDIDATES,
    fetchMarmitonRecipe,
    marmitonSourceKey,
    searchMarmiton,
} from './marmiton';
import { RecipeCandidate, RecipeSort, spokenRecipeQuery } from './parse';
import { addRecipeIngredients, summarizeRecipe } from './recipe';
import {
    RecipeRecordInput,
    deleteRecipe,
    findRecipeByScanId,
    findRecipeByTitle,
    getRecipe,
    listRecipes,
    recipeSourceKey,
    savedSourceKeys,
    upsertRecipe,
} from './store';

export {
    findRecipeByScanId,
    findRecipeByTitle,
    getRecipe,
    listRecipes,
    searchMarmiton,
};
export { spokenRecipeQuery };
export type { RecipeCandidate, RecipeSort };

/** Follow-ups the UI and the agent offer on a stored recipe. */
export const RECIPE_ACTIONS = [
    { id: 'add-to-shopping', label: 'Ajouter aux courses' },
];

/** A search result, plus whether the household already saved it. */
export interface RankedRecipeCandidate extends RecipeCandidate {
    stored: boolean;
}

function text(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(Math.max(Math.trunc(value), min), max);
}

/** Search results, best-rated first, marked when already in the library. */
export async function searchRecipes(
    query: string,
    options: { limit?: number; sort?: RecipeSort } = {}
): Promise<RankedRecipeCandidate[]> {
    const candidates = await searchMarmiton(query, options);
    if (!candidates.length) return [];

    const keys = candidates.map((c) => recipeSourceKey('marmiton', c.id));
    const saved = new Set(await savedSourceKeys(keys));
    return candidates.map((candidate, index) => ({
        ...candidate,
        stored: saved.has(keys[index]),
    }));
}

export interface ImportRecipeInput {
    /** A Marmiton recipe page (the exact thing the user pasted). */
    url?: string;
    /** Or a search term; `index` picks among the ranked candidates. */
    query?: string;
    /** Position in the ranking (0 = the best-rated one). */
    index?: number;
    /** Ranking used when `query` is given (default `rating`). */
    sort?: RecipeSort;
}

/**
 * Import one recipe into the library.
 *
 * `{ url }` imports exactly that page; `{ query }` searches, ranks and imports
 * the candidate at `index` — so "prends la meilleure recette de poulet
 * basquaise" is the first item of the rating ranking, not whatever the site
 * happened to list first.
 */
export async function importRecipe(
    input: ImportRecipeInput,
    user?: string
): Promise<RecipeRecord> {
    const url = text(input?.url);
    if (url) return importFromUrl(url, user);

    const query = text(input?.query);
    if (!query) {
        throw new Error('give a Marmiton recipe URL or a search query');
    }

    const candidates = await searchMarmiton(query, {
        limit: MAX_CANDIDATES,
        sort: input?.sort ?? 'rating',
    });
    if (!candidates.length) {
        throw new Error(`no recipe found for "${query}"`);
    }

    const index = clamp(input?.index ?? 0, 0, candidates.length - 1);
    return importFromUrl(candidates[index].url, user);
}

/** One page → one record (an upsert: importing twice updates, never duplicates). */
async function importFromUrl(url: string, user?: string): Promise<RecipeRecord> {
    const sourceKey = marmitonSourceKey(url);
    if (!sourceKey) {
        throw new Error(`${url} is not a Marmiton recipe page`);
    }

    const parsed = await fetchMarmitonRecipe(url);

    const input: RecipeRecordInput = {
        sourceKey,
        source: 'marmiton',
        recipe: parsed.recipe,
        summary: summarizeRecipe(parsed.recipe, parsed.rating),
        ...(parsed.sourceUrl ? { sourceUrl: parsed.sourceUrl } : {}),
        ...(parsed.imageUrl ? { imageUrl: parsed.imageUrl } : {}),
        ...(parsed.description ? { description: parsed.description } : {}),
        ...(parsed.category ? { category: parsed.category } : {}),
        ...(parsed.author ? { author: parsed.author } : {}),
        ...(parsed.keywords ? { keywords: parsed.keywords } : {}),
        ...(parsed.rating ? { rating: parsed.rating } : {}),
        ...(parsed.totalTimeS ? { totalTimeS: parsed.totalTimeS } : {}),
        ...(user ? { user } : {}),
    };

    const record = await upsertRecipe(input);
    log('recipes', `Imported « ${record.recipe.title} »`, {
        context: {
            sourceKey,
            ingredients: record.recipe.ingredients.length,
            steps: record.recipe.steps.length,
            ...(record.rating ? { rating: record.rating.value } : {}),
        },
    });
    return record;
}

export interface RecipeActionResult {
    ok: boolean;
    message?: string;
    error?: string;
}

/**
 * Run one of `RECIPE_ACTIONS` on a stored recipe.
 *
 * Same shape and wording as `vision#runScanAction`, because it is the same
 * gesture on the same shape of data — the tab shows the same button whether the
 * recipe came from a photo or from a page.
 */
export async function runRecipeAction(
    id: string,
    actionId: string,
    ctx?: { user?: string }
): Promise<RecipeActionResult> {
    if (!RECIPE_ACTIONS.some((action) => action.id === actionId)) {
        return { ok: false, error: `unknown action ${actionId}` };
    }

    const record = await getRecipe(id);
    if (!record) return { ok: false, error: 'recipe not found' };

    try {
        const count = await addRecipeIngredients(record.recipe, ctx?.user);
        log(
            'recipes',
            `Added ${count} ingredient(s) from « ${record.recipe.title} »`,
            { context: { recipeId: id } }
        );
        return {
            ok: true,
            message: `Added ${count} ingredient(s) from "${record.recipe.title}" to the shopping list.`,
        };
    } catch (e) {
        return { ok: false, error: (e as any)?.message ?? 'the action failed' };
    }
}

/** `add-to-shopping`, as a named call for the tools and the UI. */
export function addRecipeToShopping(id: string, user?: string) {
    return runRecipeAction(id, 'add-to-shopping', { user });
}

/** Remove one recipe from the library. */
export function removeRecipe(id: string): Promise<boolean> {
    return deleteRecipe(id);
}

/**
 * File a recipe read from a photo into the household library.
 *
 * Identity is the **document** (`scan:<scanId>`), exactly like an imported page
 * is its page (`marmiton:<id>`): the same paper scanned twice is two documents,
 * and running the action again updates the same record instead of adding a
 * second one. Without a scan id (an agent handing over the data itself) the
 * folded title is the identity, so the library still cannot grow a duplicate of
 * the same recipe.
 */
export async function saveScannedRecipe(
    recipe: Recipe,
    options: { scanId?: string; user?: string } = {}
): Promise<RecipeRecord> {
    const id = text(options.scanId) ?? foldName(recipe.title);
    const sourceKey = recipeSourceKey('scan', id);

    const record = await upsertRecipe({
        sourceKey,
        source: 'scan',
        recipe,
        summary: summarizeRecipe(recipe),
        ...(options.scanId ? { scanId: options.scanId } : {}),
        ...(options.user ? { user: options.user } : {}),
    });

    log('recipes', `Saved the scanned recipe « ${record.recipe.title} »`, {
        context: { sourceKey, ingredients: recipe.ingredients?.length ?? 0 },
    });
    return record;
}