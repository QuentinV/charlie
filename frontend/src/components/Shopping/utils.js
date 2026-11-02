/**
 * Shared helpers of the Shopping tab.
 *
 * The category list mirrors the backend enum (`GroceryCategory`): the same
 * order is used to group the items the way a shopper walks the aisles.
 */
export const CATEGORY_ORDER = [
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

/** Quantity label of an item ("3 pièce", "1,5 kg", ""). */
export function formatQuantity(item) {
    const q = item?.quantity;
    if (q === undefined || q === null) return item?.unit ?? '';
    const n = Number.isInteger(q) ? String(q) : String(q).replace('.', ',');
    return item?.unit ? `${n} ${item.unit}` : n;
}

/** Items grouped per aisle, in shopping order, empty categories dropped. */
export function groupItems(items) {
    return CATEGORY_ORDER.map((category) => ({
        category,
        items: (items ?? []).filter((i) => (i.category ?? 'autre') === category),
    })).filter((group) => group.items.length > 0);
}

/** Short "what's in the basket" summary for the collapsed header. */
export function basketPeek(items, max = 3) {
    const names = (items ?? []).map((i) => i.name).filter(Boolean);
    if (names.length <= max) return names.join(', ');
    return `${names.slice(0, max).join(', ')} +${names.length - max}`;
}

/**
 * True while the restructurer has work to do (drives the polling). A failed run
 * stops the polling: the user decides (retry / apply verbatim).
 */
export function isStructuring(list) {
    const state = list?.processing?.state ?? 'idle';
    if (state === 'failed') return false;
    return (list?.pending?.length ?? 0) > 0 || state === 'running';
}
