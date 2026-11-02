/**
 * Pure helpers for the shopping list.
 *
 * The list is fed with *raw* user requests (voice, chat, free text) and a
 * background job (small LLM) turns them into items. Everything in this file is
 * deterministic and side-effect free: name folding (so "Yaourts" and "yaourt"
 * merge into one line), quantity/unit normalisation, the systematic splitting
 * of a free sentence into item chunks, and the fallback parser used when the
 * structuring model is unavailable.
 */
import { GroceryCategory, ShoppingItem } from '../types';

/** Item before it gets an id/status: what a parser (LLM or fallback) returns. */
export type ParsedItem = Pick<
    ShoppingItem,
    'name' | 'quantity' | 'unit' | 'category' | 'note'
> & { user?: string };

/**
 * Aisles in the order a shopper walks them. Kept as the single source of truth
 * for the category enum, the LLM JSON schema and the UI grouping.
 */
export const GROCERY_CATEGORIES: GroceryCategory[] = [
    'fruits-legumes',
    'boulangerie',
    'boucherie',
    'poissonnerie',
    'cremerie',
    'epicerie',
    'surgeles',
    'boissons',
    'hygiene',
    'entretien',
    'autre',
];

export function isGroceryCategory(value: unknown): value is GroceryCategory {
    return (
        typeof value === 'string' &&
        (GROCERY_CATEGORIES as string[]).includes(value)
    );
}

/**
 * French plural fold of a single word: "baguettes" must compare equal to
 * "baguette". Only the trailing s/x of a word longer than 3 characters is
 * dropped ("os", "riz", "jus" are left alone), and both sides of a comparison
 * go through the same fold, so it stays consistent.
 */
function foldWord(word: string): string {
    if (word.length > 3 && /[sx]$/.test(word)) return word.slice(0, -1);
    return word;
}

/**
 * Comparison key of an item name: lowercase, unaccented, punctuation dropped
 * and plurals folded. "Crème fraîche", "creme fraiche", "BAGUETTES de pain" and
 * "baguette de pain" all fold together.
 */
export function foldName(name?: string | null): string {
    return (name ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map(foldWord)
        .filter(Boolean)
        .join(' ');
}

const UNIT_ALIASES: { [key: string]: string } = {
    g: 'g',
    gr: 'g',
    gramme: 'g',
    grammes: 'g',
    kg: 'kg',
    kilo: 'kg',
    kilos: 'kg',
    kilogramme: 'kg',
    kilogrammes: 'kg',
    mg: 'mg',
    ml: 'ml',
    cl: 'cl',
    l: 'L',
    litre: 'L',
    litres: 'L',
    liter: 'L',
    liters: 'L',
    piece: 'pièce',
    pieces: 'pièce',
    unite: 'pièce',
    unites: 'pièce',
    boite: 'boîte',
    boites: 'boîte',
    paquet: 'paquet',
    paquets: 'paquet',
    sachet: 'sachet',
    sachets: 'sachet',
    bouteille: 'bouteille',
    bouteilles: 'bouteille',
    pot: 'pot',
    pots: 'pot',
    barquette: 'barquette',
    barquettes: 'barquette',
    tranche: 'tranche',
    tranches: 'tranche',
    douzaine: 'douzaine',
    douzaines: 'douzaine',
    botte: 'botte',
    bottes: 'botte',
    conserve: 'conserve',
    conserves: 'conserve',
    rouleau: 'rouleau',
    rouleaux: 'rouleau',
    poche: 'poche',
    poches: 'poche',
    filet: 'filet',
    filets: 'filet',
    portion: 'portion',
    portions: 'portion',
};

/**
 * Units the structuring model is allowed to emit, as ASCII tokens (safe for the
 * JSON-schema grammar): `normalizeUnit` maps them back to their canonical,
 * accented form. Anything outside this list is impossible to generate, which is
 * what stops the small model from inventing a unit ("en", "boulet", "bouche").
 */
export const UNIT_ENUM = [
    'g',
    'kg',
    'ml',
    'cl',
    'L',
    'piece',
    'boite',
    'paquet',
    'sachet',
    'bouteille',
    'pot',
    'barquette',
    'tranche',
    'douzaine',
    'botte',
    'conserve',
    'rouleau',
    'poche',
    'filet',
    'portion',
];

/** Canonical form of a unit ("litres" → "L"), undefined when not recognized. */
export function normalizeUnit(unit?: string | null): string | undefined {
    if (!unit) return undefined;
    const folded = foldName(unit);
    if (!folded) return undefined;
    return UNIT_ALIASES[folded] ?? folded;
}

/**
 * Every surface form a canonical unit can be written with ("L" → l, litre,
 * litres, liter, liters): the reverse of UNIT_ALIASES.
 */
export function unitAliases(unit?: string | null): string[] {
    const canonical = normalizeUnit(unit);
    if (!canonical) return [];
    return Object.keys(UNIT_ALIASES).filter((k) => UNIT_ALIASES[k] === canonical);
}

/**
 * A unit is only kept when the user actually said it. The model is asked for a
 * unit but answers with a *valid* one the request never mentioned ("pièce" for
 * "5 baguettes de pain"), which would silently change the meaning of the line —
 * evidence beats the model's guess, exactly like a gateway-gated reading.
 */
export function unitMentionedInTexts(
    unit: string | undefined,
    texts: string[]
): boolean {
    const aliases = unitAliases(unit);
    if (!aliases.length) return false;
    const words = new Set(
        (texts ?? [])
            .map((t) => foldName(t))
            .join(' ')
            .split(' ')
            .filter(Boolean)
    );
    return aliases.some((alias) => words.has(foldName(alias)));
}

/**
 * Words of a folded string that carry evidence: short ones ("de", "du", "la")
 * are noise when deciding whether an item was actually asked for.
 */
export function significantWords(text?: string | null): string[] {
    return foldName(text)
        .split(' ')
        .filter((w) => w.length >= 3);
}

/**
 * An item the model produced must be traceable to the requests of this run: at
 * least one significant word of its name has to appear in them. A line the
 * model echoed back from its context — an item already on the list that the
 * user never asked for here — has no such word and is dropped, which is what
 * stops an unrelated row from being incremented.
 */
export function nameBackedByTexts(name: string, texts: string[]): boolean {
    const foldedName = foldName(name);
    if (!foldedName) return false;

    const foldedTexts = (texts ?? []).map((t) => foldName(t));
    const knownWords = new Set(
        foldedTexts.flatMap((t) => t.split(' ').filter(Boolean))
    );
    const words = significantWords(foldedName);

    // Very short names ("os") have no significant word: require an exact word
    // match instead of dropping a legitimate request.
    const candidates = words.length
        ? words
        : foldedName.split(' ').filter(Boolean);

    return candidates.some((w) => knownWords.has(w));
}

/**
 * Reject a unit that is in fact the item name ("baguette" as the unit of
 * "baguette de pain"): a container/brand word, never the thing itself.
 */
export function unitContradictsName(
    unit: string | undefined,
    name: string
): boolean {
    const normalized = normalizeUnit(unit);
    if (!normalized) return false;
    const unitWords = foldName(normalized).split(' ');
    const nameWords = foldName(name).split(' ');
    return unitWords.some((w) => !!w && nameWords.includes(w));
}

/** Parse "1,5" / "2" / 3 into a positive number, ignoring anything else. */
export function parseQuantity(
    value?: string | number | null
): number | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const n =
        typeof value === 'number'
            ? value
            : Number(String(value).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return n;
}

/**
 * Identity of a shopping line: the folded name plus its unit. Two rows with the
 * same key are the same thing to buy, whatever their spelling — this is what
 * makes "1 baguette de pain" and "5 baguettes de pain" one line.
 */
export function itemKey(item: Pick<ShoppingItem, 'name' | 'unit'>): string {
    return `${foldName(item.name)}|${normalizeUnit(item.unit) ?? ''}`;
}

/** Merge `added` into `target`: quantities summed, first known metadata wins. */
function absorb(target: ShoppingItem, added: ShoppingItem): ShoppingItem {
    target.quantity = (target.quantity ?? 1) + (added.quantity ?? 1);
    target.unit = normalizeUnit(target.unit) ?? normalizeUnit(added.unit);
    target.category = target.category ?? added.category;
    target.note = target.note ?? added.note;
    target.user = target.user ?? added.user;
    target.addedAt = Math.min(
        target.addedAt ?? added.addedAt,
        added.addedAt ?? target.addedAt
    );
    // A line stays "to buy" as long as one of the merged rows was: never bury
    // something the shopper may still need.
    const todo = target.status === 'todo' || added.status === 'todo';
    target.status = todo ? 'todo' : 'taken';
    target.takenAt = todo
        ? undefined
        : Math.max(target.takenAt ?? 0, added.takenAt ?? 0) || undefined;
    return target;
}

/**
 * Fold `incoming` into `existing`: quantities of the same name+unit are summed
 * ("2 baguettes" + "une baguette" → 3) and the first known category/note wins.
 * A line asked again goes back to "to buy" (see `absorb`): asking for bread
 * while it sits in the basket means "buy more", not "already done".
 */
export function mergeItems(
    existing: ShoppingItem[],
    incoming: ShoppingItem[]
): ShoppingItem[] {
    const out = (existing ?? []).map((i) => ({ ...i }));

    for (const item of incoming ?? []) {
        if (!foldName(item.name)) continue;
        const key = itemKey(item);
        const match = out.find((e) => itemKey(e) === key);
        if (match) absorb(match, item);
        else out.push({ ...item });
    }

    return out;
}

/**
 * Collapse the rows of a list that are the same line — the model may have
 * produced "baguette de pain" and "baguettes de pain" before plurals were
 * folded, or the same request may have been structured twice. Quantities are
 * summed, so an existing list heals itself on the next structuring run.
 */
export function dedupeItems(items: ShoppingItem[]): ShoppingItem[] {
    const out: ShoppingItem[] = [];

    for (const item of items ?? []) {
        if (!foldName(item.name)) continue;
        const key = itemKey(item);
        const existing = out.find((e) => itemKey(e) === key);
        if (existing) absorb(existing, item);
        else out.push({ ...item });
    }

    return out;
}

/** French number words understood by the fallback parser. */
const NUMBER_WORDS: { [key: string]: number } = {
    un: 1,
    une: 1,
    deux: 2,
    trois: 3,
    quatre: 4,
    cinq: 5,
    six: 6,
    sept: 7,
    huit: 8,
    neuf: 9,
    dix: 10,
    douze: 12,
    vingt: 20,
};

const UNIT_PATTERN =
    'g|gr|grammes?|kg|kilos?|kilogrammes?|mg|ml|cl|l|litres?|liters?|pieces?|unites?|boites?|paquets?|sachets?|bouteilles?|pots?|barquettes?|tranches?|douzaines?|bottes?|conserves?|rouleaux?|poches?|filets?|portions?';

/**
 * Phrases that belong to the command rather than to the item ("ajoute **du
 * lait à ma liste de courses**"). Stripped by the NLU action and, defensively,
 * before parsing a request.
 */
const LIST_PHRASES = [
    'a ma liste de courses',
    'a la liste de courses',
    'dans ma liste de courses',
    'dans la liste de courses',
    'sur ma liste de courses',
    'sur la liste de courses',
    'a ma liste',
    'a la liste',
    'dans ma liste',
    'dans la liste',
    'sur ma liste',
    'sur la liste',
    'liste de courses',
    'aux courses',
    'de courses',
];

/**
 * Articles stripped from the start of a request. "un"/"une" are deliberately
 * absent: they are number words too ("une douzaine d'oeufs" is a quantity), and
 * the deterministic parser reads them as such.
 */
const LEADING_ARTICLES = ['du', 'de la', 'de l', 'des', 'le', 'la', 'les'];

/**
 * Command verbs that belong to the sentence, not to the item
 * ("**ajoute** du lait", "**il me faut** des pommes"). Only ever stripped at
 * the very beginning of a request.
 */
const LEADING_COMMANDS = [
    'ajoute',
    'ajouter',
    'rajoute',
    'rajouter',
    'mets',
    'met',
    'mettre',
    'note',
    'noter',
    'prends',
    'prendre',
    'achete',
    'acheter',
    'il me faut',
    'il faut',
    'j ai besoin de',
    'j ai besoin',
    'besoin de',
];

/**
 * Remove one leading phrase from `text` (matched accent/case insensitive on the
 * folded form, so "J'ai besoin de" and "j ai besoin de" behave the same), and
 * return the text unchanged when it does not start with any of them.
 * Both sides are folded: the folding is defined on names *and* phrases.
 */
function stripLeading(text: string, phrases: string[]): string {
    const folded = foldName(text);
    const match = phrases.find((p) => {
        const target = foldName(p);
        return !!target && (folded === target || folded.startsWith(`${target} `));
    });
    if (!match) return text;
    const count = match.split(' ').length;
    return text
        .split(/\s+/)
        .slice(count)
        .join(' ')
        .trim();
}

/**
 * Remove one trailing phrase ("... à ma liste de courses") from `text`.
 */
function stripTrailing(text: string, phrases: string[]): string {
    const folded = foldName(text);
    const match = phrases.find((p) => {
        const target = foldName(p);
        return !!target && folded.endsWith(target);
    });
    if (!match) return text;
    const count = match.split(' ').length;
    const words = text.split(/\s+/);
    return words
        .slice(0, Math.max(0, words.length - count))
        .join(' ')
        .trim();
}

/**
 * Normalise a raw request into "what the user wants to buy": the list mention
 * and the leading command/article are dropped ("ajoute du lait à ma liste de
 * courses" → "lait"). The original spelling of the item is preserved.
 */
export function sanitizeRequestText(raw?: string | null): string {
    let text = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '';

    // Bounded loop: one list mention and one command verb at most, but the
    // strips can uncover each other ("ajoute des" → "des" → item).
    for (let guard = 0; guard < 4; ++guard) {
        const before = text;
        text = stripTrailing(text, LIST_PHRASES);
        text = stripLeading(text, LEADING_COMMANDS);
        text = stripLeading(text, LEADING_ARTICLES);
        text = text.trim();
        if (text === before) break;
        if (!text) return '';
    }

    return text;
}

/** Split a free sentence into candidate item chunks. */
export function splitChunks(text: string): string[] {
    return (text ?? '')
        .split(/\n|,|;|\+|\s+puis\s+|\s+et\s+|\s+avec\s+/i)
        .map((c) => c.trim())
        .filter(Boolean);
}

/**
 * Best-effort "quantity + unit + name" parse of one chunk:
 * "2 litres de lait", "une douzaine d'oeufs", "3 pommes", "pain".
 */
export function parseChunk(chunk: string): ParsedItem | undefined {
    let rest = foldName(chunk);
    if (!rest) return undefined;

    let quantity: number | undefined;
    let unit: string | undefined;

    // A word boundary after the unit keeps "2 lait" intact ("l" must not eat
    // the beginning of "lait").
    const numeric = rest.match(
        new RegExp(
            `^(\\d+(?:[.,]\\d+)?)\\s*((?:${UNIT_PATTERN})\\b)?\\s*(?:de |d )?(.+)$`
        )
    );

    if (numeric) {
        quantity = parseQuantity(numeric[1]);
        unit = normalizeUnit(numeric[2]);
        rest = numeric[3];
    } else {
        const words = rest.split(' ');
        const word = NUMBER_WORDS[words[0]];
        if (word !== undefined) {
            quantity = word;
            rest = words.slice(1).join(' ');
            const withUnit = rest.match(
                new RegExp(`^(?:${UNIT_PATTERN})\\b\\s+(?:de |d )?(.+)$`)
            );
            if (withUnit) {
                unit = normalizeUnit(rest.split(' ')[0]);
                rest = withUnit[1];
            }
        }
    }

    const name = stripLeading(rest, LEADING_ARTICLES).trim();
    if (!name) return undefined;

    return { name, quantity, unit };
}

/**
 * Deterministic parser used when the structuring model is unavailable: enough
 * to keep shopping possible (names and rough quantities), never a replacement
 * for it.
 */
export function fallbackItems(texts: string[]): ParsedItem[] {
    const items: ParsedItem[] = [];
    for (const text of texts ?? []) {
        for (const chunk of splitChunks(sanitizeRequestText(text))) {
            const parsed = parseChunk(chunk);
            if (parsed) items.push(parsed);
        }
    }
    return items;
}

/** Display/spoken quantity of an item ("3 pièce" → "3 pièce", "" when none). */
export function formatQuantity(item: ShoppingItem): string {
    if (item.quantity === undefined || item.quantity === null) {
        return item.unit ?? '';
    }
    const q = Number.isInteger(item.quantity)
        ? String(item.quantity)
        : String(item.quantity).replace('.', ',');
    return item.unit ? `${q} ${item.unit}` : q;
}

/** Items grouped per aisle, in shopping order, skipping empty categories. */
export function groupByCategory(
    items: ShoppingItem[]
): { category: GroceryCategory; items: ShoppingItem[] }[] {
    return GROCERY_CATEGORIES.map((category) => ({
        category,
        items: (items ?? []).filter((i) => (i.category ?? 'autre') === category),
    })).filter((g) => g.items.length > 0);
}
