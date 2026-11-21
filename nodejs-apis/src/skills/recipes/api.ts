/**
 * REST surface of the cooking skill.
 *
 * The Recettes tab is the only client, but nothing here is UI-shaped: the same
 * routes serve a script or Node-RED, and they all go through the skill's public
 * functions (`skills/recipes/index.ts`).
 *
 * Like every household document these routes stay behind the auth gate.
 */
import { RecipeRecord, RestApis } from '../../types';
import {
    RECIPE_ACTIONS,
    getRecipe,
    importRecipe,
    listRecipes,
    removeRecipe,
    runRecipeAction,
    searchRecipes,
} from './index';
import { RecipeSort } from './parse';

/** Public shape of a recipe: `id` instead of `_id`, plus its follow-ups. */
export function publicRecipe(record: RecipeRecord) {
    const { _id, ...rest } = record;
    return {
        id: _id,
        ...rest,
        actions: RECIPE_ACTIONS.map((action) => action.id),
    };
}

function sortOf(value: unknown): RecipeSort {
    return value === 'relevance' ? 'relevance' : 'rating';
}

const routes: RestApis = {
    recipes: {
        get: {
            handler: async ({ query }) => ({
                recipes: (
                    await listRecipes({
                        query:
                            typeof query?.query === 'string'
                                ? query.query
                                : undefined,
                        // `scanId` is the Scan tab asking "did I already file this
                        // document in my recipes?" — the answer is the link it shows.
                        scanId:
                            typeof query?.scanId === 'string'
                                ? query.scanId
                                : undefined,
                        limit: Number(query?.limit) || 20,
                    })
                ).map(publicRecipe),
            }),
            description:
                'Saved recipes, newest first (filtered by text or by the scan they came from)',
            querySchema: {
                query: { type: 'string', required: false },
                scanId: { type: 'string', required: false },
                limit: { type: 'number', required: false },
            },
        },
    },
    'recipes/search': {
        get: {
            handler: async ({ query }) => {
                const term =
                    typeof query?.q === 'string' ? query.q.trim() : '';
                if (!term) return { candidates: [] };

                try {
                    return {
                        candidates: await searchRecipes(term, {
                            limit: Number(query?.limit) || undefined,
                            sort: sortOf(query?.sort),
                        }),
                    };
                } catch (e) {
                    // The site being unreachable is not a client error: the tab
                    // shows the message and keeps the library usable.
                    return {
                        candidates: [],
                        error:
                            (e as any)?.message ??
                            'the recipe search failed',
                    };
                }
            },
            description:
                'Search Marmiton recipes (not saved): best-rated first by default',
            querySchema: {
                q: { type: 'string', required: true },
                limit: { type: 'number', required: false },
                sort: { type: 'string', required: false },
            },
        },
    },
    'recipes/import': {
        post: {
            fullHandler: async ({ body, user }, res: any) => {
                try {
                    const record = await importRecipe(
                        {
                            url:
                                typeof body?.url === 'string'
                                    ? body.url
                                    : undefined,
                            query:
                                typeof body?.query === 'string'
                                    ? body.query
                                    : undefined,
                            index: Number.isFinite(Number(body?.index))
                                ? Number(body.index)
                                : undefined,
                            sort: sortOf(body?.sort),
                        },
                        (user as any)?.name ??
                            (typeof body?.user === 'string'
                                ? body.user
                                : undefined)
                    );
                    res.json({ recipe: publicRecipe(record) });
                } catch (e) {
                    // A page that cannot be read is a 422 with the reason: the
                    // tab shows it instead of saving half a recipe.
                    res.status(422).json({
                        message:
                            (e as any)?.message ?? 'the recipe could not be read',
                    });
                }
            },
            description:
                'Import a Marmiton recipe into the library: {url} or {query, index}',
        },
    },
    'recipes/:id': {
        get: {
            handler: async ({ params }) => {
                const record = await getRecipe(params.id);
                return record
                    ? { recipe: publicRecipe(record) }
                    : { error: 'not found' };
            },
            description: 'One saved recipe, with its ingredients and steps',
        },
        delete: {
            handler: async ({ params }) => ({
                removed: await removeRecipe(params.id),
            }),
            description: 'Remove a recipe from the library',
        },
    },
    'recipes/:id/actions/:action': {
        post: {
            handler: async ({ params, body, user }) =>
                runRecipeAction(params.id, params.action, {
                    user:
                        (user as any)?.name ??
                        (typeof body?.user === 'string'
                            ? body.user
                            : undefined),
                }),
            description:
                'Run one of the recipe’s actions (add-to-shopping puts its ingredients on the list)',
        },
    },
};

export default routes;