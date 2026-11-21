/**
 * Pure parsing of a Marmiton page — no fetch, no database, no registry, so the
 * tests drive it with the *captured* pages in `__tests__/fixtures/`.
 *
 * Two contracts are used, in this order of trust:
 *
 * 1. the recipe itself comes from the page's `schema.org/Recipe` JSON-LD, a
 *    standard published for machines — names, times, yields and units are read,
 *    never guessed;
 * 2. only the *search* result cards are site-specific HTML (`search-list__item`),
 *    and a card only has to give a title, a URL and a rating: the recipe is
 *    always read from its own page afterwards.
 *
 * Everything a grammar cannot express is decided here, deliberately:
 * - the site's SEO title suffix (" : la meilleure recette") is stripped, so a
 *   recipe imported twice under two spellings stays one library entry;
 * - a unit is only kept when a positive quantity backs it (`sel` has no unit),
 *   and only from the household vocabulary (`recipeUnitLabel`);
 * - a parenthesised precision becomes the ingredient's `note`, nothing else is
 *   split — the page is evidence, not a guess.
 */
import {
    Recipe,
    RecipeEstimatedFor,
    RecipeIngredient,
    RecipeRating,
} from '../../types';
import { estimatedForOf, recipeUnitLabel } from './recipe';

export const MARMITON_ORIGIN = 'https://www.marmiton.org';

/** A recipe cannot take a day: above this the answer is a mistake, not a time. */
const MAX_DURATION_S = 24 * 60 * 60;

/** The captured SEO suffix of a Marmiton title (`og:title` carries it too). */
export const RECIPE_TITLE_SUFFIX = /\s*:\s*la meilleure recette\s*$/i;

/** A recipe candidate of a search page: what a picker needs, nothing more. */
export interface RecipeCandidate {
    /** Site id ("16969"), also the dedupe key. */
    id: string;
    title: string;
    url: string;
    imageUrl?: string;
    category?: string;
    rating?: RecipeRating;
}

/** A recipe page, parsed: the recipe and the provenance around it. */
export interface ParsedRecipePage {
    recipe: Recipe;
    sourceUrl?: string;
    imageUrl?: string;
    description?: string;
    category?: string;
    author?: string;
    keywords?: string[];
    rating?: RecipeRating;
    /** The page's own total time (prep + cook + rest). */
    totalTimeS?: number;
}

/** Trimmed non-empty string, or undefined. */
function text(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const s = value.trim();
    return s ? s : undefined;
}

/** A shopping-list mention ends the recipe name in a spoken request. */
const LIST_TAIL =
    /\s+(?:(?:dans|sur|a|à)\s+)?(?:(?:ma|la|notre)\s+liste|liste\s+de\s+courses|aux?\s+courses)\b/i;

/** Leading article/preposition of a spoken recipe name ("au poulet basquaise"). */
const LEADING_WORD = /^(?:au|aux|a|à|de|du|des|le|la|les|une?|l'|d')\s+/i;

/**
 * The recipe name inside a spoken request.
 *
 * The NLU hands over whatever the intent's `starts` did not consume, which still
 * carries grammar: "ajoute les ingrédients de la recette **au** poulet basquaise
 * **dans ma liste de courses**" must resolve to "poulet basquaise", or the
 * library lookup would miss a recipe that is right there. Pure, so the rule is
 * tested instead of discovered in production.
 */
export function spokenRecipeQuery(value?: string | null): string {
    const raw = (value ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';

    // Everything from a list mention onwards belongs to the list, not the recipe.
    const cut = raw.search(LIST_TAIL);
    const head = (cut > 0 ? raw.slice(0, cut) : raw).replace(/\s+/g, ' ').trim();

    const stripped = head.replace(LEADING_WORD, '').trim();
    return stripped || head;
}

/** Finite number, or undefined ("4.7" and 4.7 both read). */
function number(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
        const n = Number(value.replace(',', '.').replace(/\s/g, ''));
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}

/** A positive amount, or undefined: `0` is never a quantity. */
function positive(value: unknown): number | undefined {
    const n = number(value);
    return n !== undefined && n > 0 ? n : undefined;
}

function ensureArray<T>(value: T | T[] | null | undefined): T[] {
    if (value === null || value === undefined) return [];
    return Array.isArray(value) ? value : [value];
}

// ===== Title =====

/**
 * The recipe name as the household should see it: the page appends an SEO
 * suffix to every title ("Poulet basquaise : la meilleure recette" — captured on
 * five pages, see `fixtures/README.md`), which is not part of the recipe name.
 */
export function cleanRecipeTitle(value: unknown): string | undefined {
    const raw = text(value);
    if (!raw) return undefined;
    const cleaned = raw.replace(RECIPE_TITLE_SUFFIX, '').trim();
    return cleaned || undefined;
}

/** `recette_poulet-basquaise_16969.aspx` → "Poulet basquaise" (last resort). */
function titleFromUrl(url: string): string | undefined {
    const slug = url.match(/recette_([a-z0-9-]+)_\d+\.aspx/i)?.[1];
    if (!slug) return undefined;
    const words = slug.replace(/-/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : undefined;
}

// ===== Times and yield =====

/**
 * ISO-8601 duration in seconds: `PT20M` → 1200, `PT1H20M` → 4800, `PT45S` → 45.
 * Absent, malformed or absurd → 0 ("the source does not say"), never a guess.
 */
export function isoDurationSeconds(value: unknown): number {
    const raw = text(value);
    if (!raw) return 0;
    const match = raw.match(
        /^P(?:(\d+)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i
    );
    if (!match) return 0;

    const days = number(match[1]) ?? 0;
    const hours = number(match[2]) ?? 0;
    const minutes = number(match[3]) ?? 0;
    const seconds = number(match[4]) ?? 0;
    const total = Math.round(
        days * 86400 + hours * 3600 + minutes * 60 + seconds
    );
    return total > 0 && total <= MAX_DURATION_S ? total : 0;
}

/**
 * Yield of a page: `"6 personnes"` → 6 people, `"20 crêpes"` → 20 items named
 * "crêpes". The scanned recipe fills the same two numbers, so the tab and the
 * voice show a web recipe exactly like a photographed one.
 */
export function parseRecipeYield(
    value: unknown
): RecipeEstimatedFor | undefined {
    const raw = ensureArray(value).map((v) => text(v)).find(Boolean);
    if (!raw) return undefined;

    const persons = number(raw.match(/(\d+)\s*personnes?/i)?.[1]);
    if (persons) return estimatedForOf(persons, persons);

    const count = raw.match(/^\s*(?:pour\s+)?(\d+)\s+(.+?)\s*$/i);
    if (!count) return undefined;

    const quantity = positive(count[1]);
    const name = count[2]?.replace(/[.,;:]+$/, '').trim();
    if (!quantity) return undefined;
    return estimatedForOf(0, quantity, name || undefined);
}
// ===== Ingredients =====

/** "1/2" → 0.5, "1,5" → 1.5, "700" → 700. */
function parseAmount(value: string): number | undefined {
    const fraction = value.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (fraction) {
        const numerator = Number(fraction[1]);
        const denominator = Number(fraction[2]);
        if (denominator > 0) return numerator / denominator;
    }
    return positive(value.replace(',', '.'));
}

/**
 * The unit at the beginning of these words, longest match first: "cuillères à
 * soupe" is a unit, "cuillères" alone is not (the token is `cuillere_a_soupe`)
 * — and a word the vocabulary does not know (`pâte`, `oeufs`) never consumes
 * anything, so it stays in the name.
 */
function takeUnit(words: string[]): { unit?: string; consumed: number } {
    for (const span of [3, 2, 1]) {
        if (words.length < span) continue;
        const unit = recipeUnitLabel(words.slice(0, span).join(' '));
        if (unit) return { unit, consumed: span };
    }
    return { consumed: 0 };
}

/** "de lait", "d'huile d'olive" → "lait", "huile d'olive". */
function stripConnector(value: string): string {
    let out = value.trim();
    for (let guard = 0; guard < 3; guard++) {
        const before = out;
        out = out
            .replace(/^(?:de|du|des|la|le|les|une?)\s+/i, '')
            .replace(/^(?:l|d)'/i, '')
            .trim();
        if (out === before) break;
    }
    return out;
}

/**
 * One ingredient line → name, quantity, unit and note.
 *
 * `"700 g de poivrons (verts et rouges)"` → `{ name: 'poivrons', quantity: 700,
 * unit: 'g', note: 'verts et rouges' }`; `"sel"` → `{ name: 'sel' }` — no
 * quantity means no unit, the rule the scanned recipe already enforces.
 * A line that cannot be split is kept verbatim rather than dropped.
 */
export function parseIngredientLine(
    line?: string | null
): RecipeIngredient | undefined {
    const raw = (line ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) return undefined;

    // A parenthesised precision is a note, never part of the name.
    let body = raw;
    let note: string | undefined;
    const paren = raw.match(/\(([^)]*)\)/);
    if (paren) {
        note = text(paren[1]);
        const at = paren.index ?? 0;
        body = `${raw.slice(0, at)} ${raw.slice(at + paren[0].length)}`
            .replace(/\s+/g, ' ')
            .trim();
    }

    const amount = body.match(/^(\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (!amount) return { name: raw };

    const quantity = parseAmount(amount[1]);
    let rest = amount[2] ?? '';

    let unit: string | undefined;
    if (quantity) {
        const words = rest.split(' ').filter(Boolean);
        const taken = takeUnit(words);
        unit = taken.unit;
        rest = words.slice(taken.consumed).join(' ');
    }

    const name = stripConnector(rest);
    if (!name) return { name: raw };

    return {
        name,
        ...(quantity ? { quantity } : {}),
        ...(quantity && unit ? { unit } : {}),
        ...(note ? { note } : {}),
    };
}

// ===== Steps =====

function stepTexts(value: unknown): string[] {
    if (typeof value === 'string') {
        return value
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    if (Array.isArray(value)) return value.flatMap(stepTexts);
    if (!value || typeof value !== 'object') return [];

    const node = value as any;
    const type = typeOf(node);
    if (type.includes('HowToSection') || (!node.text && node.itemListElement)) {
        return stepTexts(node.itemListElement ?? node.steps);
    }
    const own = text(node.text);
    return own ? [own] : stepTexts(node.itemListElement);
}

// ===== JSON-LD =====

const LD_JSON =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function typeOf(node: any): string[] {
    const t = node?.['@type'];
    return Array.isArray(t) ? t : typeof t === 'string' ? [t] : [];
}

function flattenNodes(value: unknown, out: any[] = []): any[] {
    if (Array.isArray(value)) {
        for (const item of value) flattenNodes(item, out);
        return out;
    }
    if (!value || typeof value !== 'object') return out;
    const node = value as any;
    if (Array.isArray(node['@graph'])) {
        for (const item of node['@graph']) flattenNodes(item, out);
    }
    out.push(node);
    return out;
}

/** Every node of every `ld+json` block of a page (graph nodes included). */
export function jsonLdNodes(html: string): any[] {
    const nodes: any[] = [];
    // A fresh regex per call: a shared `lastIndex` would skip blocks between
    // two parses of the same string.
    const pattern = new RegExp(LD_JSON.source, 'gi');

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html ?? ''))) {
        try {
            flattenNodes(JSON.parse(match[1]), nodes);
        } catch {
            // A broken block is skipped: the next one may still hold the recipe.
        }
    }
    return nodes;
}

/** The `schema.org/Recipe` node of a page, if it has one. */
export function recipeNode(html: string): any | undefined {
    return jsonLdNodes(html).find((node) => typeOf(node).includes('Recipe'));
}

function imageOf(value: unknown): string | undefined {
    for (const item of ensureArray(value)) {
        if (typeof item === 'string') {
            const url = text(item);
            if (url) return url;
        } else if (item && typeof item === 'object') {
            const url =
                text((item as any).url) ?? text((item as any).contentUrl);
            if (url) return url;
        }
    }
    return undefined;
}

function keywordsOf(value: unknown): string[] | undefined {
    const keywords = ensureArray(value)
        .flatMap((v) =>
            typeof v === 'string' ? v.split(',') : [text((v as any)?.name)]
        )
        .map((v) => text(v))
        .filter((v): v is string => !!v);
    return keywords.length ? keywords : undefined;
}

function ratingOf(value: unknown): RecipeRating | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const node = value as any;
    const rating = positive(node.ratingValue);
    if (!rating) return undefined;
    return { value: rating, count: number(node.reviewCount) ?? 0 };
}

/** A `schema.org/Recipe` node → the household's recipe shape. */
export function mapRecipeNode(
    node: any,
    sourceUrl?: string
): ParsedRecipePage | undefined {
    const title = cleanRecipeTitle(node?.name);
    if (!title) return undefined;

    const ingredients = ensureArray(node?.recipeIngredient)
        .map((line) =>
            parseIngredientLine(
                typeof line === 'string' ? line : text((line as any)?.name)
            )
        )
        .filter((i): i is RecipeIngredient => !!i);
    // No usable ingredient list is a failed import, not an empty recipe —
    // exactly what the vision pipeline decides for a scanned page.
    if (!ingredients.length) return undefined;

    const estimatedFor = parseRecipeYield(node?.recipeYield);
    const category = ensureArray(node?.recipeCategory)
        .map((v) => text(v))
        .find(Boolean);
    const author = text(
        typeof node?.author === 'string' ? node.author : node?.author?.name
    );
    const description = text(node?.description);
    const imageUrl = imageOf(node?.image);
    const keywords = keywordsOf(node?.keywords);
    const rating = ratingOf(node?.aggregateRating);
    const totalTimeS = isoDurationSeconds(node?.totalTime);

    return {
        recipe: {
            title,
            ...(estimatedFor ? { estimatedFor } : {}),
            prepTimeS: isoDurationSeconds(node?.prepTime),
            cookTimeS: isoDurationSeconds(node?.cookTime),
            ingredients,
            steps: stepTexts(node?.recipeInstructions),
        },
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(description ? { description } : {}),
        ...(category ? { category } : {}),
        ...(author ? { author } : {}),
        ...(keywords ? { keywords } : {}),
        ...(rating ? { rating } : {}),
        ...(totalTimeS ? { totalTimeS } : {}),
    };
}

/** A whole recipe page → the recipe and its provenance. */
export function recipeFromJsonLd(
    html: string,
    sourceUrl?: string
): ParsedRecipePage | undefined {
    const node = recipeNode(html);
    return node ? mapRecipeNode(node, sourceUrl) : undefined;
}

// ===== Search cards =====

function decodeEntities(value: string): string {
    return value
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16))
        )
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
        .replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'")
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&');
}

function stripTags(value: string): string {
    return decodeEntities(value.replace(/<[^>]*>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}

/** `/recettes/recette_x_1.aspx` or an absolute URL → absolute URL. */
export function absoluteMarmitonUrl(href: string): string {
    const url = decodeEntities((href ?? '').trim());
    if (/^https?:\/\//i.test(url)) return url;
    return `${MARMITON_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * The result cards of a search page.
 *
 * The page's own JSON-LD `ItemList` is **not** used: it is not the result list
 * (a nonsense query returned unrelated crêpes entries — see
 * `fixtures/README.md`), while the cards always are.
 */
export function parseSearchCards(html: string): RecipeCandidate[] {
    const candidates: RecipeCandidate[] = [];
    const seen = new Set<string>();
    const opening = /<li[^>]*class="[^"]*\bsearch-list__item\b[^"]*"/gi;

    let match: RegExpExecArray | null;
    while ((match = opening.exec(html ?? ''))) {
        const close = html.indexOf('</li>', match.index);
        if (close < 0) continue;
        const block = html.slice(match.index, close);
        opening.lastIndex = close;

        const href = block.match(
            /href="([^"]*\/recettes\/recette_[^"]+\.aspx)"?/i
        )?.[1];
        if (!href) continue;

        const url = absoluteMarmitonUrl(href);
        const id =
            block.match(/data-algolia-object-id="(\d+)"/i)?.[1] ??
            url.match(/_(\d+)\.aspx/i)?.[1];
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const titleAnchor = block.match(
            /<a[^>]*class="[^"]*card-content__title[^"]*"[^>]*>([\s\S]*?)<\/a>/i
        )?.[1];
        const title =
            cleanRecipeTitle(stripTags(titleAnchor ?? '')) ?? titleFromUrl(url);
        if (!title) continue;

        const categoryTag = block.match(
            /class="[^"]*image-label[^"]*"[^>]*>([\s\S]*?)<\/div>/i
        )?.[1];
        const ratingTag = block.match(
            /class="[^"]*rating__rating[^"]*"[^>]*>([\s\S]*?)<\/div>/i
        )?.[1];
        const ratingValue = positive(
            ratingTag?.match(/([\d.,]+)\s*\/\s*5/)?.[1]
        );
        const ratingCount = number(
            block
                .match(
                    /class="[^"]*rating__nbreviews[^"]*"[^>]*>([\s\S]*?)<\/div>/i
                )?.[1]
                ?.match(/([\d\s.,]+)\s*avis/i)?.[1]
        );
        const image = block.match(/<img[^>]*\bsrc="([^"]+)"/i)?.[1];

        candidates.push({
            id,
            title,
            url,
            ...(image ? { imageUrl: absoluteMarmitonUrl(image) } : {}),
            ...(categoryTag ? { category: stripTags(categoryTag) } : {}),
            ...(ratingValue
                ? { rating: { value: ratingValue, count: ratingCount ?? 0 } }
                : {}),
        });
    }

    return candidates;
}

export type RecipeSort = 'relevance' | 'rating';

/**
 * Below this many reviews a star average is noise, not a ranking signal: the
 * captured page carries a sponsored card at **5/5 with 2 avis**, which would
 * otherwise outrank a 4.9 backed by 277 people. Such a card is still displayed
 * with its stars, it is just not *chosen* for the household.
 */
export const MIN_RATED_COUNT = 5;

function rankingRating(candidate: RecipeCandidate): RecipeRating | undefined {
    const rating = candidate.rating;
    return rating && rating.count >= MIN_RATED_COUNT ? rating : undefined;
}

/**
 * The order the household picks a recipe in.
 *
 * `rating` (the default) puts the best-rated first — value, then how many
 * people rated it, then the page's own order for the rest — and cards without a
 * credible rating last (no stars, or too few votes). `relevance` keeps the
 * site's order. Deterministic and explainable, because "prends la meilleure
 * recette" has to mean something.
 */
export function rankCandidates(
    candidates: RecipeCandidate[],
    sort: RecipeSort = 'rating'
): RecipeCandidate[] {
    const list = [...(candidates ?? [])];
    if (sort === 'relevance') return list;

    return list
        .map((candidate, index) => ({
            candidate,
            index,
            rating: rankingRating(candidate),
        }))
        .sort((a, b) => {
            if (!a.rating && !b.rating) return a.index - b.index;
            if (!a.rating) return 1;
            if (!b.rating) return -1;
            if (b.rating.value !== a.rating.value) {
                return b.rating.value - a.rating.value;
            }
            if (b.rating.count !== a.rating.count) {
                return b.rating.count - a.rating.count;
            }
            return a.index - b.index;
        })
        .map((entry) => entry.candidate);
}