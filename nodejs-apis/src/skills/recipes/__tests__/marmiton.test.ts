/**
 * The Marmiton adapter against a stubbed network: what it asks for, how often,
 * and what it refuses. The parsing itself is covered by `parse.test.ts` on the
 * captured pages.
 */

// `uuid` v13 is ESM-only and Jest does not transform node_modules.
jest.mock('uuid', () => ({
    v4: () => '00000000-0000-4000-8000-000000000000',
    v7: () => '00000000-0000-7000-8000-000000000000',
}));

import fs from 'fs';
import path from 'path';
import {
    MAX_CANDIDATES,
    fetchMarmitonRecipe,
    isMarmitonUrl,
    marmitonIdOf,
    marmitonSearchUrl,
    marmitonSourceKey,
    resetMarmitonCache,
    searchMarmiton,
    setMarmitonFetch,
} from '../marmiton';
import poulet from './fixtures/marmiton-recipe-poulet-basquaise.json';

const searchHtml = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'marmiton-search-poulet.html'),
    'utf8'
);

const PAGE_URL =
    'https://www.marmiton.org/recettes/recette_poulet-basquaise_16969.aspx';

const pageHtml = `<html><head><script type="application/ld+json">${JSON.stringify(
    { '@context': 'https://schema.org', '@graph': [poulet] }
)}</script></head><body></body></html>`;

function ok(body: string) {
    return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(body),
    }) as unknown as ReturnType<typeof fetch>;
}

function failing(status: number) {
    return Promise.resolve({
        ok: false,
        status,
        text: () => Promise.resolve(''),
    }) as unknown as ReturnType<typeof fetch>;
}

function stub(impl: (url: string) => Promise<any>) {
    const calls: string[] = [];
    const mock = (url: string) => {
        calls.push(url);
        return impl(url);
    };
    setMarmitonFetch(mock as unknown as typeof fetch);
    return calls;
}

beforeEach(() => resetMarmitonCache());

describe('the URLs the adapter is allowed to use', () => {
    test('search is the aqt page, never a paginated one', () => {
        // robots.txt disallows `?page=` and `?aqt=*page*`: the adapter must not
        // even build such a URL.
        const url = marmitonSearchUrl('poulet basquaise');
        expect(url).toBe(
            'https://www.marmiton.org/recettes/recherche.aspx?aqt=poulet%20basquaise'
        );
        expect(url).not.toContain('page=');
    });

    test('a recipe page is recognized, with its site id', () => {
        expect(isMarmitonUrl(PAGE_URL)).toBe(true);
        expect(isMarmitonUrl('https://www.marmiton.org/recettes/index/plat')).toBe(
            false
        );
        expect(isMarmitonUrl('https://example.com/recettes/recette_x_1.aspx')).toBe(
            false
        );
        expect(marmitonIdOf(PAGE_URL)).toBe('16969');
        expect(marmitonSourceKey(PAGE_URL)).toBe('marmiton:16969');
        expect(marmitonSourceKey('https://example.com/x')).toBeUndefined();
    });
});

describe('search', () => {
    test('one request, ranked, capped at the ten best-rated', async () => {
        const calls = stub(() => ok(searchHtml));

        const candidates = await searchMarmiton('poulet');
        expect(calls).toEqual([
            'https://www.marmiton.org/recettes/recherche.aspx?aqt=poulet',
        ]);
        expect(candidates).toHaveLength(MAX_CANDIDATES);
        expect(candidates[0].title).toBe('Filet de poulet au curry');
    });

    test('a second search is served from the cache', async () => {
        const calls = stub(() => ok(searchHtml));
        await searchMarmiton('poulet');
        await searchMarmiton('poulet');
        expect(calls).toHaveLength(1);
    });

    test('relevance keeps the page order', async () => {
        stub(() => ok(searchHtml));
        const candidates = await searchMarmiton('poulet', {
            sort: 'relevance',
            limit: 3,
        });
        expect(candidates.map((c) => c.id)).toEqual(['17751', '80990', '19374']);
    });

    test('an empty query never hits the network', async () => {
        const calls = stub(() => ok(searchHtml));
        expect(await searchMarmiton('   ')).toEqual([]);
        expect(calls).toEqual([]);
    });
});

describe('one recipe page', () => {
    test('reads the recipe and keeps the URL as provenance', async () => {
        const calls = stub(() => ok(pageHtml));

        const parsed = await fetchMarmitonRecipe(PAGE_URL);
        expect(calls).toEqual([PAGE_URL]);
        expect(parsed.recipe.title).toBe('Poulet basquaise');
        expect(parsed.sourceUrl).toBe(PAGE_URL);
        expect(parsed.rating).toEqual({ value: 4.7, count: 692 });
    });

    test('the page is cached for the next import', async () => {
        const calls = stub(() => ok(pageHtml));
        await fetchMarmitonRecipe(PAGE_URL);
        await fetchMarmitonRecipe(PAGE_URL);
        expect(calls).toHaveLength(1);
    });

    test('a page without Recipe data throws instead of saving half a recipe', async () => {
        stub(() => ok('<html><body>consent wall</body></html>'));
        await expect(fetchMarmitonRecipe(PAGE_URL)).rejects.toThrow(
            /readable recipe/
        );
    });

    test('a non-recipe URL is refused before any request', async () => {
        const calls = stub(() => ok(pageHtml));
        await expect(
            fetchMarmitonRecipe('https://example.com/recette')
        ).rejects.toThrow(/not a Marmiton recipe page/);
        expect(calls).toEqual([]);
    });

    test('an HTTP failure is reported with its status', async () => {
        stub(() => failing(404));
        await expect(fetchMarmitonRecipe(PAGE_URL)).rejects.toThrow(/404/);
    });
});