/**
 * The Marmiton adapter: the only file of the cooking skill that knows a website.
 *
 * It exposes exactly two calls — `searchMarmiton(query)` and
 * `fetchMarmitonRecipe(url)` — and both return the household's own shape
 * (`RecipeCandidate[]`, `ParsedRecipePage`), so a second site later is another
 * adapter with the same two functions, never a second pipeline.
 *
 * Network policy, deliberately conservative (see `README.md`):
 * - only `/recettes/recherche.aspx?aqt=…` and recipe pages. `robots.txt`
 *   disallows `?page=` and `?aqt=*page*`, so the search is **page 1 only** — a
 *   specific recipe is always reachable by its URL;
 * - at most one request per second to the site, a 10 s deadline per request, an
 *   identifying User-Agent;
 * - answers are cached (search 10 min, pages 24 h) and concurrent callers share
 *   the in-flight request, like `skills/weather/service.ts`.
 */
import {
    MARMITON_ORIGIN,
    ParsedRecipePage,
    RecipeCandidate,
    RecipeSort,
    parseSearchCards,
    rankCandidates,
    recipeFromJsonLd,
} from './parse';

/** Hosts a pasted link may use (`www.marmiton.org` is what the site serves). */
const MARMITON_HOSTS = ['marmiton.org', 'www.marmiton.org'];

const SEARCH_PATH = '/recettes/recherche.aspx';
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const REQUEST_TIMEOUT_MS = 10_000;
/** Politeness: one request per second to the site, whatever the caller does. */
const MIN_REQUEST_INTERVAL_MS = 1000;
const SEARCH_CACHE_MS = 10 * 60 * 1000;
const PAGE_CACHE_MS = 24 * 60 * 60 * 1000;
/** Candidates kept from one search page (it lists 10–17 cards). */
export const MAX_CANDIDATES = 10;

type MarmitonFetch = typeof fetch;

let fetchImpl: MarmitonFetch = (input, init) => fetch(input, init);

/** Test seam: the suite never touches the network. */
export function setMarmitonFetch(impl: MarmitonFetch): void {
    fetchImpl = impl;
}

interface CacheEntry<T> {
    value: T;
    at: number;
    ttl: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Drop the caches (tests, or after a layout change is suspected). */
export function resetMarmitonCache(): void {
    cache.clear();
    inFlight.clear();
    lastRequestAt = 0;
}

function cached<T>(key: string, ttl: number): T | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.at > entry.ttl) {
        cache.delete(key);
        return undefined;
    }
    return entry.value as T;
}

function remember<T>(key: string, value: T, ttl: number): T {
    cache.set(key, { value, at: Date.now(), ttl });
    return value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One throttled GET, serialized with the previous ones. */
async function getHtml(url: string): Promise<string> {
    const run = async () => {
        const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
        if (wait > 0) await sleep(wait);
        lastRequestAt = Date.now();

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetchImpl(url, {
                headers: {
                    'User-Agent': USER_AGENT,
                    Accept: 'text/html,application/xhtml+xml',
                    'Accept-Language': 'fr-FR,fr;q=0.9',
                },
                signal: controller.signal,
            });
            if (!response?.ok) {
                throw new Error(
                    `marmiton answered ${response?.status ?? 'nothing'} for ${url}`
                );
            }
            return await response.text();
        } finally {
            clearTimeout(timer);
        }
    };

    // Never let two request slots overlap: the throttle above is only correct
    // if the calls are serialized.
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
}

/** The `aqt` search URL — the one surface `robots.txt` allows (page 1). */
export function marmitonSearchUrl(query: string): string {
    return `${MARMITON_ORIGIN}${SEARCH_PATH}?aqt=${encodeURIComponent(
        (query ?? '').trim()
    )}`;
}

/** True when the URL is a Marmiton recipe page. */
export function isMarmitonUrl(url?: string): boolean {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        return (
            MARMITON_HOSTS.includes(parsed.hostname.toLowerCase()) &&
            /\/recettes\/recette_[\w-]+_\d+\.aspx$/i.test(parsed.pathname)
        );
    } catch {
        return false;
    }
}

/** Site id of a recipe URL ("16969"), undefined when the URL is not one. */
export function marmitonIdOf(url?: string): string | undefined {
    if (!isMarmitonUrl(url)) return undefined;
    return url!.match(/_(\d+)\.aspx/i)?.[1];
}

/** Dedupe key of an imported page (`marmiton:16969`). */
export function marmitonSourceKey(url: string): string | undefined {
    const id = marmitonIdOf(url);
    return id ? `marmiton:${id}` : undefined;
}

/**
 * The result cards of a query, best-rated first by default.
 *
 * One request, one page: pagination is disallowed for robots, and a household
 * lookup rarely needs more than the ten best-rated candidates.
 */
export async function searchMarmiton(
    query: string,
    options: { limit?: number; sort?: RecipeSort } = {}
): Promise<RecipeCandidate[]> {
    const term = (query ?? '').trim();
    if (!term) return [];

    const limit = Math.min(
        Math.max(options.limit ?? MAX_CANDIDATES, 1),
        MAX_CANDIDATES
    );
    const sort = options.sort ?? 'rating';
    const key = `search:${term}:${limit}:${sort}`;

    const hit = cached<RecipeCandidate[]>(key, SEARCH_CACHE_MS);
    if (hit) return hit;

    const pending = inFlight.get(key);
    if (pending) return pending as Promise<RecipeCandidate[]>;

    const request = (async () => {
        try {
            const html = await getHtml(marmitonSearchUrl(term));
            const candidates = rankCandidates(
                parseSearchCards(html),
                sort
            ).slice(0, limit);
            return remember(key, candidates, SEARCH_CACHE_MS);
        } finally {
            inFlight.delete(key);
        }
    })();

    inFlight.set(key, request);
    return request;
}

/**
 * One recipe page, parsed.
 *
 * A page without a readable `schema.org/Recipe` (a 404, a consent wall, a layout
 * the site changed) throws: an import either gives the household a full recipe
 * or nothing at all.
 */
export async function fetchMarmitonRecipe(
    url: string
): Promise<ParsedRecipePage> {
    if (!isMarmitonUrl(url)) {
        throw new Error(`${url} is not a Marmiton recipe page`);
    }

    const key = `page:${url}`;
    const hit = cached<ParsedRecipePage>(key, PAGE_CACHE_MS);
    if (hit) return hit;

    const pending = inFlight.get(key);
    if (pending) return pending as Promise<ParsedRecipePage>;

    const request = (async () => {
        try {
            const html = await getHtml(url);
            const parsed = recipeFromJsonLd(html, url);
            if (!parsed) {
                throw new Error(
                    'this page does not contain a readable recipe (no schema.org/Recipe data)'
                );
            }
            return remember(key, parsed, PAGE_CACHE_MS);
        } finally {
            inFlight.delete(key);
        }
    })();

    inFlight.set(key, request);
    return request;
}