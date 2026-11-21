/**
 * The composition, not the pieces: `importRecipe` turns a page into a library
 * record with the shape a scanned recipe has, `{query}` follows the ranking, and
 * importing the same page twice updates instead of duplicating.
 *
 * The adapter is replaced (its own suite covers the network) and the collection
 * is an in-memory Mongo; what is asserted here is the wiring between them.
 */

jest.mock('uuid', () => {
    let next = 0;
    return {
        v4: () => `00000000-0000-4000-8000-0000000001${String(++next).padStart(2, '0')}`,
        v7: () => `00000000-0000-7000-8000-0000000001${String(++next).padStart(2, '0')}`,
    };
});

jest.mock('../../../manager/services/activities', () => ({
    log: jest.fn(),
}));

jest.mock('../marmiton', () => ({
    ...jest.requireActual('../marmiton'),
    searchMarmiton: jest.fn(),
    fetchMarmitonRecipe: jest.fn(),
}));

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
                this.rows.sort((a, b) => ((a[key] ?? 0) - (b[key] ?? 0)) * dir);
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
                return { matchedCount: 1 };
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
            const index = state.recipes.findIndex((doc) => matches(doc, query));
            if (index < 0) return { deletedCount: 0 };
            state.recipes.splice(index, 1);
            return { deletedCount: 1 };
        },
    };

    return { cs: { recipes }, __state: state };
});

import { fetchMarmitonRecipe, searchMarmiton } from '../marmiton';
import { mapRecipeNode } from '../parse';
import {
    findRecipeByScanId,
    importRecipe,
    listRecipes,
    saveScannedRecipe,
    searchRecipes,
} from '../index';
import poulet from './fixtures/marmiton-recipe-poulet-basquaise.json';

const PAGE_URL =
    'https://www.marmiton.org/recettes/recette_poulet-basquaise_16969.aspx';
const OTHER_URL =
    'https://www.marmiton.org/recettes/recette_tarte-aux-pommes_18588.aspx';

const db = jest.requireMock('../../../core/db') as {
    __state: { recipes: any[] };
};
const searchMock = searchMarmiton as jest.MockedFunction<typeof searchMarmiton>;
const fetchMock = fetchMarmitonRecipe as jest.MockedFunction<
    typeof fetchMarmitonRecipe
>;

const parsedPage = mapRecipeNode(poulet, PAGE_URL)!;

beforeEach(() => {
    db.__state.recipes.length = 0;
    jest.clearAllMocks();
    fetchMock.mockResolvedValue(parsedPage);
    searchMock.mockResolvedValue([]);
});

describe('importing a page', () => {
    test('the record carries the recipe and its provenance', async () => {
        const record = await importRecipe({ url: PAGE_URL }, 'Quentin');

        expect(fetchMock).toHaveBeenCalledWith(PAGE_URL);
        expect(record.sourceKey).toBe('marmiton:16969');
        expect(record.source).toBe('marmiton');
        // The same shape a scanned recipe has.
        expect(record.recipe.title).toBe('Poulet basquaise');
        expect(record.recipe.ingredients).toHaveLength(10);
        expect(record.recipe.prepTimeS).toBe(20 * 60);
        // The rating is stored, and spoken in the summary.
        expect(record.rating).toEqual({ value: 4.7, count: 692 });
        expect(record.summary).toContain('Recette « Poulet basquaise »');
        expect(record.summary).toContain('Notée 4,7/5 (692 avis).');
        expect(record.sourceUrl).toBe(PAGE_URL);
        expect(record.imageUrl).toContain('assets.afcdn.com');
        expect(record.user).toBe('Quentin');
        // The folds the library searches on.
        expect(record.titleFold).toBe('poulet basquaise');
        expect(record.ingredientsFold).toContain('poivron');
    });

    test('the same page twice is one record, refreshed', async () => {
        const first = await importRecipe({ url: PAGE_URL });
        const second = await importRecipe({ url: PAGE_URL });

        expect(db.__state.recipes).toHaveLength(1);
        expect(second._id).toBe(first._id);
        expect(second.createdAt).toBe(first.createdAt);
    });

    test('an unusable page is an error, not a half recipe', async () => {
        fetchMock.mockRejectedValue(new Error('no schema.org/Recipe data'));
        await expect(importRecipe({ url: PAGE_URL })).rejects.toThrow(
            /schema\.org\/Recipe/
        );
        expect(db.__state.recipes).toEqual([]);
    });

    test('a URL that is not a recipe is refused before fetching', async () => {
        await expect(
            importRecipe({ url: 'https://example.com/recette' })
        ).rejects.toThrow(/not a Marmiton recipe page/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('neither a URL nor a query is a caller mistake', async () => {
        await expect(importRecipe({})).rejects.toThrow(
            /URL or a search query/
        );
    });
});

describe('importing by query follows the ranking', () => {
    test('index 0 of the rating order is the one fetched', async () => {
        searchMock.mockResolvedValue([
            {
                id: '16969',
                title: 'Poulet basquaise',
                url: PAGE_URL,
                rating: { value: 4.9, count: 400 },
            },
            {
                id: '18588',
                title: 'Tarte aux pommes',
                url: OTHER_URL,
                rating: { value: 4.5, count: 90 },
            },
        ]);

        const record = await importRecipe({ query: 'poulet basquaise' });
        expect(searchMock).toHaveBeenCalledWith('poulet basquaise', {
            limit: 10,
            sort: 'rating',
        });
        expect(fetchMock).toHaveBeenCalledWith(PAGE_URL);
        expect(record.sourceKey).toBe('marmiton:16969');
    });

    test('an explicit index picks another candidate', async () => {
        searchMock.mockResolvedValue([
            { id: '16969', title: 'Un', url: PAGE_URL },
            { id: '18588', title: 'Deux', url: OTHER_URL },
        ]);

        const record = await importRecipe({ query: 'poulet', index: 1 });
        expect(fetchMock).toHaveBeenCalledWith(OTHER_URL);
        expect(record.sourceKey).toBe('marmiton:18588');
    });

    test('no candidate is a readable error', async () => {
        await expect(importRecipe({ query: 'zzzz' })).rejects.toThrow(
            /no recipe found/
        );
    });
});

describe('a search knows what the library already has', () => {
    test('candidates are marked as stored', async () => {
        await importRecipe({ url: PAGE_URL });

        searchMock.mockResolvedValue([
            { id: '16969', title: 'Poulet basquaise', url: PAGE_URL },
            { id: '18588', title: 'Tarte aux pommes', url: OTHER_URL },
        ]);

        const candidates = await searchRecipes('poulet');
        expect(candidates.map((c) => c.stored)).toEqual([true, false]);
    });
});

describe('filing a scanned recipe', () => {
    const recipe = parsedPage.recipe;

    test('the document is the identity, and the record points back at it', async () => {
        const record = await saveScannedRecipe(recipe, {
            scanId: 'scan-7',
            user: 'marie',
        });

        expect(record.sourceKey).toBe('scan:scan-7');
        expect(record.source).toBe('scan');
        expect(record.scanId).toBe('scan-7');
        expect(record.recipe.title).toBe('Poulet basquaise');
        expect(record.summary).toContain('Recette « Poulet basquaise »');
        expect(record.user).toBe('marie');
        // A scan is filed from what the vision pipeline already read: no fetch.
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('running it again updates the same record', async () => {
        const first = await saveScannedRecipe(recipe, { scanId: 'scan-7' });
        const second = await saveScannedRecipe(recipe, { scanId: 'scan-7' });

        expect(db.__state.recipes).toHaveLength(1);
        expect(second._id).toBe(first._id);
        expect(second.createdAt).toBe(first.createdAt);
    });

    test('the Scan tab finds it by scan, and can tell it is filed', async () => {
        await saveScannedRecipe(recipe, { scanId: 'scan-7' });

        expect((await findRecipeByScanId('scan-7'))!.sourceKey).toBe(
            'scan:scan-7'
        );
        expect(await findRecipeByScanId('scan-9')).toBeUndefined();
        expect(
            (await listRecipes({ scanId: 'scan-7' })).map((r) => r.sourceKey)
        ).toEqual(['scan:scan-7']);
        expect(await listRecipes({ scanId: 'scan-9' })).toEqual([]);
    });

    test('without a scan id the folded title is the identity', async () => {
        const first = await saveScannedRecipe(recipe);
        const second = await saveScannedRecipe({
            ...recipe,
            title: '  poulet BASQUAISE ',
        });

        expect(first.sourceKey).toBe('scan:poulet basquaise');
        expect(db.__state.recipes).toHaveLength(1);
        expect(second._id).toBe(first._id);
    });
});