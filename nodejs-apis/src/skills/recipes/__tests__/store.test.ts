/**
 * The `recipes` collection: identity (an import twice is one record), folds,
 * ordering, search and delete. In-memory Mongo, same style as the shopping suite.
 */

// `uuid` v13 is ESM-only and Jest does not transform node_modules. A counter,
// because the store's identity depends on two records having distinct ids.
jest.mock('uuid', () => {
    let next = 0;
    return {
        v4: () => `00000000-0000-4000-8000-0000000000${String(++next).padStart(2, '0')}`,
        v7: () => `00000000-0000-7000-8000-0000000000${String(++next).padStart(2, '0')}`,
    };
});

jest.mock('../../../core/db', () => {
    const state: { recipes: any[] } = { recipes: [] };

    const matches = (doc: any, query: any) =>
        Object.entries(query ?? {}).every(([key, value]: [string, any]) =>
            value && typeof value === 'object' && '$in' in value
                ? value.$in.includes(doc[key])
                : doc[key] === value
        );

    class Cursor {
        rows: any[];

        constructor(rows: any[]) {
            this.rows = [...rows];
        }

        sort(spec: any) {
            const key = Object.keys(spec ?? {})[0];
            if (key) {
                const dir = spec[key] === -1 ? -1 : 1;
                this.rows.sort(
                    (a, b) => ((a[key] ?? 0) - (b[key] ?? 0)) * dir
                );
            }
            return this;
        }

        limit(count: number) {
            this.rows = this.rows.slice(0, count);
            return this;
        }

        async toArray() {
            return this.rows;
        }
    }

    const recipes = {
        findOne: async (query: any) =>
            state.recipes.find((doc) => matches(doc, query)) ?? null,
        updateOne: async (query: any, patch: any, options?: any) => {
            const existing = state.recipes.find((doc) => matches(doc, query));
            if (existing) {
                Object.assign(existing, patch?.$set ?? {});
                return { matchedCount: 1, modifiedCount: 1 };
            }
            if (options?.upsert) {
                state.recipes.push({ ...query, ...(patch?.$set ?? {}) });
                return { upsertedCount: 1 };
            }
            return { matchedCount: 0 };
        },
        find: (query: any = {}) =>
            new Cursor(state.recipes.filter((doc) => matches(doc, query))),
        deleteOne: async (query: any) => {
            const index = state.recipes.findIndex((doc) =>
                matches(doc, query)
            );
            if (index < 0) return { deletedCount: 0 };
            state.recipes.splice(index, 1);
            return { deletedCount: 1 };
        },
    };

    return { cs: { recipes }, __state: state };
});

import { Recipe } from '../../../types';
import {
    RecipeRecordInput,
    deleteRecipe,
    findRecipeByTitle,
    getRecipe,
    listRecipes,
    recipeSourceKey,
    savedSourceKeys,
    upsertRecipe,
} from '../store';

const db = jest.requireMock('../../../core/db') as {
    __state: { recipes: any[] };
};

function input(
    sourceKey: string,
    title: string,
    ingredients: string[] = ['tomate'],
    createdAt?: number
): RecipeRecordInput {
    const recipe: Recipe = {
        title,
        prepTimeS: 0,
        cookTimeS: 0,
        ingredients: ingredients.map((name) => ({ name })),
        steps: [],
    };
    return {
        sourceKey,
        source: 'marmiton',
        recipe,
        summary: `Recette « ${title} »`,
        ...(createdAt ? { createdAt } : {}),
    };
}

beforeEach(() => {
    db.__state.recipes.length = 0;
});

describe('identity: importing the same source twice is one record', () => {
    test('the first save creates the record, with its folds', async () => {
        const record = await upsertRecipe(
            input('marmiton:16969', 'Poulet basquaise', ['tomates', 'Oignons'])
        );

        expect(record._id).toBeTruthy();
        expect(record.titleFold).toBe('poulet basquaise');
        // Folded ingredient names, so the library searches a string.
        expect(record.ingredientsFold).toBe('tomate oignon');
        expect(db.__state.recipes).toHaveLength(1);
    });

    test('the second save updates in place', async () => {
        const first = await upsertRecipe(input('marmiton:16969', 'Poulet'));
        const second = await upsertRecipe(
            input('marmiton:16969', 'Poulet basquaise')
        );

        expect(db.__state.recipes).toHaveLength(1);
        expect(second._id).toBe(first._id);
        expect(second.createdAt).toBe(first.createdAt);
        expect(second.recipe.title).toBe('Poulet basquaise');
        expect(second.titleFold).toBe('poulet basquaise');
        expect((await getRecipe(first._id))!.recipe.title).toBe(
            'Poulet basquaise'
        );
    });

    test('another source is another record', async () => {
        await upsertRecipe(input('marmiton:1', 'Poulet'));
        await upsertRecipe(input('marmiton:2', 'Tarte'));
        expect(db.__state.recipes).toHaveLength(2);
    });

    test('the source key is derived from the source and its id', () => {
        expect(recipeSourceKey('marmiton', '16969')).toBe('marmiton:16969');
        expect(recipeSourceKey('scan', 'abc')).toBe('scan:abc');
    });
});

describe('the library', () => {
    beforeEach(async () => {
        await upsertRecipe(
            input('marmiton:1', 'Poulet basquaise', ['tomate'], 1000)
        );
        await upsertRecipe(
            input('marmiton:2', 'Pâte à crêpes', ['farine', 'lait'], 2000)
        );
    });

    test('newest first, capped by the limit', async () => {
        expect((await listRecipes()).map((r) => r.recipe.title)).toEqual([
            'Pâte à crêpes',
            'Poulet basquaise',
        ]);
        expect((await listRecipes({ limit: 1 }))).toHaveLength(1);
    });

    test('a query matches the folded title or an ingredient', async () => {
        // "crepes" finds "crêpes" (accents and case folded).
        expect((await listRecipes({ query: 'crepes' })).map((r) => r._id)).toEqual([
            db.__state.recipes.find((r: any) => r.sourceKey === 'marmiton:2')._id,
        ]);
        // "lait" is an ingredient of the crêpes only.
        expect(
            (await listRecipes({ query: 'lait' })).map((r) => r.recipe.title)
        ).toEqual(['Pâte à crêpes']);
        expect(await listRecipes({ query: 'introuvable' })).toEqual([]);
    });

    test('saved source keys mark what a search already knows', async () => {
        expect(
            await savedSourceKeys(['marmiton:1', 'marmiton:9'])
        ).toEqual(['marmiton:1']);
        expect(await savedSourceKeys([])).toEqual([]);
    });

    test('a spoken name resolves to the closest title', async () => {
        await upsertRecipe(
            input('marmiton:3', 'Poulet basquaise au Cookeo', ['tomate'], 3000)
        );

        // The exact title wins over a longer one containing it.
        expect((await findRecipeByTitle('Poulet basquaise'))!.sourceKey).toBe(
            'marmiton:1'
        );
        expect((await findRecipeByTitle('crepes'))!.sourceKey).toBe(
            'marmiton:2'
        );
        expect((await findRecipeByTitle('cookeo'))!.sourceKey).toBe(
            'marmiton:3'
        );
        expect(await findRecipeByTitle('ratatouille')).toBeUndefined();
        expect(await findRecipeByTitle('  ')).toBeUndefined();
    });

    test('deleting removes the record', async () => {
        const id = db.__state.recipes[0]._id;
        expect(await deleteRecipe(id)).toBe(true);
        expect(await getRecipe(id)).toBeUndefined();
        expect(await deleteRecipe(id)).toBe(false);
    });
});