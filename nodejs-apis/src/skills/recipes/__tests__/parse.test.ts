/**
 * Parsing of the *captured* Marmiton pages (`fixtures/README.md`).
 *
 * Every assertion below is a real line of a real page: the SEO title suffix, the
 * `"6 personnes"` / `"20 crêpes"` yields, the free-text ingredient lines with
 * their notes and recipe-only units, the `HowToStep` instructions, and the
 * search cards — which are the only site-specific markup the adapter reads.
 */

// `uuid` v13 is ESM-only and Jest does not transform node_modules.
jest.mock('uuid', () => ({
    v4: () => '00000000-0000-4000-8000-000000000000',
    v7: () => '00000000-0000-7000-8000-000000000000',
}));

import fs from 'fs';
import path from 'path';
import {
    MIN_RATED_COUNT,
    isoDurationSeconds,
    mapRecipeNode,
    parseIngredientLine,
    parseRecipeYield,
    parseSearchCards,
    rankCandidates,
    recipeFromJsonLd,
    spokenRecipeQuery,
} from '../parse';
import crepes from './fixtures/marmiton-recipe-pate-a-crepes.json';
import poulet from './fixtures/marmiton-recipe-poulet-basquaise.json';

const searchHtml = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'marmiton-search-poulet.html'),
    'utf8'
);

describe('one recipe page (captured JSON-LD)', () => {
    const page = mapRecipeNode(poulet, 'https://www.marmiton.org/x')!;

    test('the recipe exists and its SEO suffix is stripped', () => {
        expect(page).toBeDefined();
        // Captured: "Poulet basquaise : la meilleure recette".
        expect(page.recipe.title).toBe('Poulet basquaise');
    });

    test('reads the yield, the times and the category', () => {
        expect(page.recipe.estimatedFor).toEqual({ persons: 6, quantity: 6 });
        expect(page.recipe.prepTimeS).toBe(20 * 60);
        expect(page.recipe.cookTimeS).toBe(60 * 60);
        expect(page.totalTimeS).toBe(80 * 60);
        expect(page.category).toBe('Plat principal');
    });

    test('keeps the rating, which is how the best recipe is picked', () => {
        // Captured: aggregateRating { ratingValue: 4.7, reviewCount: 692 }.
        expect(page.rating).toEqual({ value: 4.7, count: 692 });
    });

    test('splits every captured ingredient line', () => {
        expect(page.recipe.ingredients).toEqual([
            // No unit is invented for a preparation: it stays in the name.
            { name: 'poulet coupé en 6 morceaux', quantity: 1 },
            { name: 'tomate', quantity: 1, unit: 'kg' },
            // The parenthesis is a precision, i.e. the ingredient's note.
            {
                name: 'poivrons',
                quantity: 700,
                unit: 'g',
                note: 'verts et rouges',
            },
            { name: 'oignons émincés', quantity: 3 },
            // A recipe-only unit, from the household vocabulary extension.
            { name: 'ail', quantity: 3, unit: 'gousse' },
            { name: 'vin blanc', quantity: 20, unit: 'cl' },
            // Unknown units are dropped, never stored: "bouquet" is not one.
            { name: 'bouquet garni', quantity: 1 },
            { name: "huile d'olive", quantity: 6, unit: 'c. à soupe' },
            // No quantity, so no unit — the same rule the scanned recipe has.
            { name: 'sel' },
            { name: 'poivre' },
        ]);
    });

    test('keeps every step, in order, without its markup', () => {
        expect(page.recipe.steps).toHaveLength(5);
        expect(page.recipe.steps[0]).toBe(
            "Hacher l'oignon et l'ail. Couper les tomates en morceaux et détailler les poivrons en lanières."
        );
        expect(page.recipe.steps[4]).toContain('35 min de cuisson.');
    });

    test('keeps the provenance the library records', () => {
        expect(page.sourceUrl).toBe('https://www.marmiton.org/x');
        expect(page.imageUrl).toContain('assets.afcdn.com/recipe/20161116');
        expect(page.author).toBe('Anonyme');
        expect(page.keywords).toContain('Facile');
        expect(page.description).toContain('Poulet basquaise');
    });
});

describe('a page whose yield is an item count', () => {
    const page = mapRecipeNode(crepes)!;

    test('yields "20 crêpes", not people', () => {
        expect(page.recipe.estimatedFor).toEqual({
            persons: 0,
            quantity: 20,
            name: 'crêpes',
        });
        expect(page.recipe.title).toBe('Pâte à crêpes simple');
        expect(page.recipe.prepTimeS).toBe(15 * 60);
        expect(page.recipe.cookTimeS).toBe(30 * 60);
    });

    test('reads a decimal quantity and the recipe-only "verre" unit', () => {
        expect(page.recipe.ingredients).toEqual([
            { name: 'oeufs', quantity: 5 },
            { name: 'farine', quantity: 500, unit: 'g' },
            { name: 'lait demi-écrémé', quantity: 1, unit: 'L' },
            { name: 'huile', quantity: 3, unit: 'c. à soupe' },
            { name: 'bière', quantity: 0.5, unit: 'verre' },
        ]);
    });
});

describe('ingredient lines (the tolerances a grammar cannot give)', () => {
    test('a name alone stays a name alone', () => {
        expect(parseIngredientLine('sel')).toEqual({ name: 'sel' });
        expect(parseIngredientLine("  huile d'olive  ")).toEqual({
            name: "huile d'olive",
        });
        expect(parseIngredientLine('')).toBeUndefined();
        expect(parseIngredientLine(undefined)).toBeUndefined();
    });

    test('fractions, containers and café spoons', () => {
        expect(parseIngredientLine('1/2 bouquet de persil')).toEqual({
            name: 'bouquet de persil',
            quantity: 0.5,
        });
        expect(parseIngredientLine('2 boîtes de tomates pelées')).toEqual({
            name: 'tomates pelées',
            quantity: 2,
            unit: 'boîte',
        });
        expect(parseIngredientLine('1 cuillère à café de sel')).toEqual({
            name: 'sel',
            quantity: 1,
            unit: 'c. à café',
        });
    });

    test('an unknown unit is dropped, never stored', () => {
        // `normalizeUnit` would happily echo "boulets"; the vocabulary check
        // is what stops it, exactly like the scanned recipe.
        expect(parseIngredientLine('3 boulets de viande')).toEqual({
            name: 'boulets de viande',
            quantity: 3,
        });
    });

    test('a line that cannot be split is kept verbatim', () => {
        // A bare number leaves no name to extract: the line is kept as it is
        // rather than dropped from the ingredient list.
        expect(parseIngredientLine('1')).toEqual({ name: '1' });
    });
});

describe('ISO-8601 durations', () => {
    test('minutes, hours, seconds and days', () => {
        expect(isoDurationSeconds('PT20M')).toBe(1200);
        expect(isoDurationSeconds('PT1H')).toBe(3600);
        expect(isoDurationSeconds('PT1H20M')).toBe(4800);
        expect(isoDurationSeconds('PT45S')).toBe(45);
        expect(isoDurationSeconds('P1D')).toBe(86400);
    });

    test('absent or absurd is 0, never a guess', () => {
        expect(isoDurationSeconds(undefined)).toBe(0);
        expect(isoDurationSeconds('')).toBe(0);
        expect(isoDurationSeconds('20 min')).toBe(0);
        expect(isoDurationSeconds('P2D')).toBe(0);
    });
});

describe('yields', () => {
    test('people, item counts and nothing', () => {
        expect(parseRecipeYield('6 personnes')).toEqual({
            persons: 6,
            quantity: 6,
        });
        expect(parseRecipeYield('Pour 4 personnes')).toEqual({
            persons: 4,
            quantity: 4,
        });
        expect(parseRecipeYield('20 crêpes')).toEqual({
            persons: 0,
            quantity: 20,
            name: 'crêpes',
        });
        expect(parseRecipeYield(['12 muffins'])).toEqual({
            persons: 0,
            quantity: 12,
            name: 'muffins',
        });
        expect(parseRecipeYield('')).toBeUndefined();
        expect(parseRecipeYield(undefined)).toBeUndefined();
    });
});

describe('a spoken request names a recipe', () => {
    test('the grammar around the name is not part of it', () => {
        expect(spokenRecipeQuery('au poulet basquaise')).toBe(
            'poulet basquaise'
        );
        expect(spokenRecipeQuery('de crêpes')).toBe('crêpes');
        expect(spokenRecipeQuery('poulet basquaise')).toBe('poulet basquaise');
    });

    test('a shopping-list mention ends the name', () => {
        // The NLU slot keeps what its `starts` did not consume: the list mention
        // must not become part of the recipe looked up.
        expect(spokenRecipeQuery('poulet basquaise ma liste courses')).toBe(
            'poulet basquaise'
        );
        expect(
            spokenRecipeQuery('au poulet basquaise dans ma liste de courses')
        ).toBe('poulet basquaise');
        expect(spokenRecipeQuery('tarte aux pommes aux courses')).toBe(
            'tarte aux pommes'
        );
    });

    test('nothing stays nothing', () => {
        expect(spokenRecipeQuery('')).toBe('');
        expect(spokenRecipeQuery(undefined)).toBe('');
        expect(spokenRecipeQuery('   ')).toBe('');
    });
});

describe('search cards (captured page)', () => {
    const candidates = parseSearchCards(searchHtml);

    test('every result card is read, once', () => {
        expect(candidates).toHaveLength(17);
        expect(new Set(candidates.map((c) => c.id)).size).toBe(17);
    });

    test('title, url, category and rating of the first card', () => {
        expect(candidates[0]).toMatchObject({
            id: '17751',
            title: 'Couscous poulet et merguez facile',
            url: 'https://www.marmiton.org/recettes/recette_couscous-poulet-et-merguez-facile_17751.aspx',
            category: 'Plat principal',
            rating: { value: 4.8, count: 618 },
        });
        expect(candidates[0].imageUrl).toContain('assets.afcdn.com');
    });

    test('every card carries an absolute URL whose id matches', () => {
        for (const candidate of candidates) {
            expect(candidate.url.startsWith('https://www.marmiton.org/')).toBe(
                true
            );
            expect(candidate.url).toContain(`_${candidate.id}.aspx`);
            expect(candidate.title.length).toBeGreaterThan(0);
        }
    });
});

describe('ranking (the household picks the best-rated one)', () => {
    const candidates = parseSearchCards(searchHtml);

    test('the best-rated with enough votes leads the list', () => {
        // Captured: 4.9 / 277 ("Filet de poulet au curry") beats the sponsored
        // 5/5 / 2, which is not a rating anybody should cook from.
        const ranked = rankCandidates(candidates);
        expect(ranked[0].title).toBe('Filet de poulet au curry');
        expect(ranked[0].rating).toEqual({ value: 4.9, count: 277 });
    });

    test('rating order: value, then how many people rated it', () => {
        const ranked = rankCandidates(candidates).filter(
            (c) => (c.rating?.count ?? 0) >= MIN_RATED_COUNT
        );
        for (let i = 1; i < ranked.length; i++) {
            const previous = ranked[i - 1].rating!;
            const current = ranked[i].rating!;
            expect(previous.value).toBeGreaterThanOrEqual(current.value);
            if (previous.value === current.value) {
                expect(previous.count).toBeGreaterThanOrEqual(current.count);
            }
        }
    });

    test('unrated cards go last, and relevance keeps the page order', () => {
        const ranked = rankCandidates([
            { id: '1', title: 'Sans note', url: 'u1' },
            {
                id: '2',
                title: 'Deux avis',
                url: 'u2',
                rating: { value: 5, count: 2 },
            },
            {
                id: '3',
                title: 'Petit',
                url: 'u3',
                rating: { value: 4, count: 40 },
            },
            {
                id: '4',
                title: 'Meilleur',
                url: 'u4',
                rating: { value: 4.9, count: 900 },
            },
        ]);
        expect(ranked.map((c) => c.id)).toEqual(['4', '3', '1', '2']);
        expect(rankCandidates(candidates, 'relevance').map((c) => c.id)).toEqual(
            candidates.map((c) => c.id)
        );
    });
});

describe('a page without a recipe is not a recipe', () => {
    test('no JSON-LD at all', () => {
        expect(
            recipeFromJsonLd('<html><body>nope</body></html>')
        ).toBeUndefined();
    });

    test('a JSON-LD block that is not a Recipe', () => {
        const html =
            '<script type="application/ld+json">{"@type":"WebPage","name":"x"}</script>';
        expect(recipeFromJsonLd(html)).toBeUndefined();
    });

    test('a Recipe with no usable ingredient list', () => {
        expect(
            mapRecipeNode({ name: 'Crêpes', recipeIngredient: [] })
        ).toBeUndefined();
        expect(
            mapRecipeNode({ name: '  ', recipeIngredient: ['farine'] })
        ).toBeUndefined();
    });
});