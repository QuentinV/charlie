/**
 * Agent tools of the cooking skill.
 *
 * The split mirrors the shapes of the vision module: the model may **look**
 * (`search-recipes`) without deciding for the household, and only acts
 * (`save-recipe`, `use-recipe`) when asked to. Ratings are part of every answer,
 * because choosing between candidates is the whole point of keeping them.
 */
import { z } from 'zod';
import { Tools } from '../../../types';
import {
    RECIPE_ACTIONS,
    getRecipe,
    importRecipe,
    listRecipes,
    runRecipeAction,
    searchRecipes,
} from '../../../skills/recipes';

/** Compact view of a recipe for the model: no image, no full step list. */
function describeRecipe(record: any) {
    return {
        id: record._id,
        title: record.recipe?.title,
        source: record.source,
        url: record.sourceUrl,
        rating: record.rating,
        serves: record.recipe?.estimatedFor?.persons || undefined,
        yields: record.recipe?.estimatedFor?.quantity
            ? `${record.recipe.estimatedFor.quantity} ${
                  record.recipe.estimatedFor.name ?? ''
              }`.trim()
            : undefined,
        prepTimeS: record.recipe?.prepTimeS,
        cookTimeS: record.recipe?.cookTimeS,
        ingredients: (record.recipe?.ingredients ?? []).map((i: any) =>
            [i.quantity, i.unit, i.name].filter(Boolean).join(' ')
        ),
        steps: record.recipe?.steps?.length,
        summary: record.summary,
        actions: RECIPE_ACTIONS.map((action) => action.id),
    };
}

const tools: Tools = {
    'search-recipes': {
        description:
            'Search cooking recipes by name or ingredient (Marmiton). Returns candidates with their rating and URL, best-rated first; nothing is saved. Call save-recipe afterwards to keep one for the household.',
        inputSchema: {
            query: z.string(),
            limit: z.number().optional(),
            sort: z.enum(['rating', 'relevance']).optional(),
        },
        exec: async ({ query, limit, sort }) => {
            const candidates = await searchRecipes(query, {
                limit: Math.min(Math.max(limit ?? 5, 1), 10),
                sort,
            });
            if (!candidates.length) {
                return `No recipe found for "${query}".`;
            }
            return JSON.stringify({ candidates });
        },
    },
    'save-recipe': {
        description:
            'Save a Marmiton recipe in the household library. Pass the URL the user gave, or a search query plus the index of the chosen candidate (0 = the best-rated one). Never save several at once.',
        inputSchema: {
            url: z.string().optional(),
            query: z.string().optional(),
            index: z.number().optional(),
            sort: z.enum(['rating', 'relevance']).optional(),
        },
        exec: async ({ url, query, index, sort }, ctx) => {
            try {
                const record = await importRecipe(
                    { url, query, index, sort },
                    ctx?.user
                );
                return JSON.stringify(describeRecipe(record));
            } catch (e) {
                return `Could not save the recipe: ${
                    (e as any)?.message ?? 'unknown error'
                }`;
            }
        },
    },
    'list-recipes': {
        description:
            'List the household’s saved recipes (newest first), with their ingredients and rating. Call it before acting on a recipe the user mentions.',
        inputSchema: {
            query: z.string().optional(),
            limit: z.number().optional(),
        },
        exec: async ({ query, limit }) => {
            const records = await listRecipes({
                query,
                limit: Math.min(Math.max(limit ?? 5, 1), 20),
            });
            if (!records.length) {
                return query
                    ? `No saved recipe matching "${query}".`
                    : 'No saved recipe yet.';
            }
            return JSON.stringify({
                recipes: records.map(describeRecipe),
            });
        },
    },
    'read-recipe': {
        description:
            'Read one saved recipe in full (ingredients, steps, times) by its id, to answer a question or to cook it.',
        inputSchema: { id: z.string() },
        exec: async ({ id }) => {
            const record = await getRecipe(id);
            if (!record) return `No saved recipe with id ${id}.`;
            return JSON.stringify(describeRecipe(record));
        },
    },
    'use-recipe': {
        description:
            'Run one of a saved recipe’s actions (`actions` of list-recipes): `add-to-shopping` puts its ingredients on the household shopping list.',
        inputSchema: { id: z.string(), action: z.string() },
        exec: async ({ id, action }, ctx) => {
            const result = await runRecipeAction(id, action, {
                user: ctx?.user,
            });
            return result.ok
                ? (result.message ?? `Ran ${action}.`)
                : `Could not run ${action}: ${result.error}`;
        },
    },
};

export default tools;