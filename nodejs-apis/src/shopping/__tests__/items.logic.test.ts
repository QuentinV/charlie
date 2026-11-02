/**
 * Pure helpers of the shopping list: name folding and merging, quantity/unit
 * normalisation, request cleaning and the deterministic fallback parser. No
 * database, no model: what is asserted here is what an LLM answer is merged
 * against.
 */
import {
    dedupeItems,
    fallbackItems,
    foldName,
    formatQuantity,
    groupByCategory,
    isGroceryCategory,
    itemKey,
    mergeItems,
    nameBackedByTexts,
    normalizeUnit,
    parseChunk,
    parseQuantity,
    sanitizeRequestText,
    significantWords,
    splitChunks,
    unitContradictsName,
    unitMentionedInTexts,
} from '../items.logic';
import { ShoppingItem } from '../../types';

function item(partial: Partial<ShoppingItem> & { name: string }): ShoppingItem {
    return {
        id: partial.name,
        status: 'todo',
        addedAt: 0,
        ...partial,
    };
}

describe('foldName', () => {
    test('accents, case, punctuation and plurals fold together', () => {
        expect(foldName('Crème Fraîche !')).toBe('creme fraiche');
        expect(foldName('  YAOURTS ')).toBe('yaourt');
        expect(foldName('baguettes de pain')).toBe('baguette de pain');
        expect(foldName(undefined)).toBe('');
    });

    test('short words and non-plural endings are left alone', () => {
        expect(foldName('riz')).toBe('riz');
        expect(foldName('jus')).toBe('jus');
        expect(foldName('lait')).toBe('lait');
    });
});

describe('normalizeUnit / parseQuantity', () => {
    test('units are canonicalised', () => {
        expect(normalizeUnit('litres')).toBe('L');
        expect(normalizeUnit('kilos')).toBe('kg');
        expect(normalizeUnit('grammes')).toBe('g');
        expect(normalizeUnit('pièces')).toBe('pièce');
        expect(normalizeUnit('')).toBeUndefined();
    });

    test('quantities accept french decimals and reject nonsense', () => {
        expect(parseQuantity('1,5')).toBe(1.5);
        expect(parseQuantity(3)).toBe(3);
        expect(parseQuantity('0')).toBeUndefined();
        expect(parseQuantity('beaucoup')).toBeUndefined();
        expect(parseQuantity(null)).toBeUndefined();
    });
});

describe('mergeItems', () => {
    test('same name + unit sums the quantities', () => {
        const existing = [item({ name: 'lait', quantity: 2, unit: 'L' })];
        const merged = mergeItems(existing, [
            item({ name: 'Lait', quantity: 1, unit: 'litres' }),
        ]);
        expect(merged).toHaveLength(1);
        expect(merged[0].quantity).toBe(3);
        expect(merged[0].unit).toBe('L');
    });

    test('plurals are the same line: 1 baguette + 5 baguettes = 6', () => {
        const merged = mergeItems(
            [item({ name: 'baguette de pain', quantity: 1 })],
            [item({ name: 'baguettes de pain', quantity: 5 })]
        );
        expect(merged).toHaveLength(1);
        expect(merged[0].quantity).toBe(6);
    });

    test('different units stay separate lines', () => {
        const merged = mergeItems(
            [item({ name: 'pommes', quantity: 1, unit: 'kg' })],
            [item({ name: 'pommes', quantity: 3 })]
        );
        expect(merged).toHaveLength(2);
    });

    test('a line asked again goes back to "to buy" and fills metadata', () => {
        const existing = [
            item({ name: 'pain', status: 'taken', takenAt: 42 }),
        ];
        const merged = mergeItems(existing, [
            item({ name: 'pain', category: 'boulangerie', note: 'complet' }),
        ]);
        expect(merged[0].status).toBe('todo');
        expect(merged[0].takenAt).toBeUndefined();
        expect(merged[0].category).toBe('boulangerie');
        expect(merged[0].note).toBe('complet');
    });

    test('an item without a name is ignored', () => {
        expect(mergeItems([], [item({ name: '   ' })])).toHaveLength(0);
    });
});

describe('sanitizeRequestText', () => {
    test('drops the list mention and the leading article', () => {
        expect(sanitizeRequestText('ajoute du lait à ma liste de courses')).toBe(
            'lait'
        );
        expect(sanitizeRequestText('des pommes dans la liste')).toBe('pommes');
        expect(sanitizeRequestText('du pain')).toBe('pain');
        expect(sanitizeRequestText('  ')).toBe('');
    });

    test('keeps a request that is only an item', () => {
        expect(sanitizeRequestText('crème fraîche')).toBe('crème fraîche');
    });

    test('keeps "un/une" when they carry the quantity', () => {
        expect(sanitizeRequestText('une douzaine d oeufs')).toBe(
            'une douzaine d oeufs'
        );
        expect(sanitizeRequestText('du pain')).toBe('pain');
    });
});

describe('splitChunks', () => {
    test('splits on separators and conjunctions', () => {
        expect(splitChunks('du lait, 2 baguettes et des pommes')).toEqual([
            'du lait',
            '2 baguettes',
            'des pommes',
        ]);
    });

    test('does not split an item name on "et" inside a word', () => {
        expect(splitChunks('du sachet de thé')).toEqual(['du sachet de thé']);
    });
});

describe('parseChunk', () => {
    test('reads quantity, unit and name', () => {
        expect(parseChunk('2 litres de lait')).toEqual({
            name: 'lait',
            quantity: 2,
            unit: 'L',
        });
        expect(parseChunk('3 pommes')).toEqual({
            name: 'pomme',
            quantity: 3,
            unit: undefined,
        });
        expect(parseChunk('une douzaine d oeufs')).toEqual({
            name: 'oeuf',
            quantity: 1,
            unit: 'douzaine',
        });
    });

    test('a bare name stays a bare name', () => {
        expect(parseChunk('pain')).toEqual({
            name: 'pain',
            quantity: undefined,
            unit: undefined,
        });
        // "l" must not eat the beginning of "lait"
        expect(parseChunk('2 lait')).toEqual({
            name: 'lait',
            quantity: 2,
            unit: undefined,
        });
    });

    test('an empty chunk is ignored', () => {
        expect(parseChunk('   ')).toBeUndefined();
    });
});

describe('fallbackItems', () => {
    test('turns a spoken sentence into items', () => {
        expect(
            fallbackItems(['ajoute du lait, 2 baguettes et des pommes'])
        ).toEqual([
            { name: 'lait', quantity: undefined, unit: undefined },
            { name: 'baguette', quantity: 2, unit: undefined },
            { name: 'pomme', quantity: undefined, unit: undefined },
        ]);
    });

    test('reads a spoken unit as quantity + unit, unsaid quantity and all', () => {
        expect(fallbackItems(['une douzaine d oeufs'])).toEqual([
            { name: 'oeuf', quantity: 1, unit: 'douzaine' },
        ]);
    });
});

describe('itemKey', () => {
    test('is name + unit, plural and accent insensitive', () => {
        expect(itemKey({ name: 'Baguettes de pain' })).toBe(
            itemKey({ name: 'baguette de pain' })
        );
        expect(itemKey({ name: 'lait', unit: 'litres' })).toBe(
            itemKey({ name: 'Lait', unit: 'L' })
        );
        expect(itemKey({ name: 'lait', unit: 'L' })).not.toBe(
            itemKey({ name: 'lait' })
        );
    });
});

describe('nameBackedByTexts', () => {
    test('an item the user did ask for is backed', () => {
        expect(nameBackedByTexts('lait', ['3L de lait'])).toBe(true);
        expect(nameBackedByTexts('baguette de pain', ['5 baguettes de pain'])).toBe(
            true
        );
        expect(nameBackedByTexts('beurre demi-sel', ['du beurre demi-sel'])).toBe(
            true
        );
    });

    test('an item the user never mentioned is not backed', () => {
        // The exact production case: milk asked, bread echoed by the model.
        expect(nameBackedByTexts('baguette de pain', ['3L de lait'])).toBe(
            false
        );
        expect(nameBackedByTexts('pomme', ['3L de lait'])).toBe(false);
    });

    test('short stop-words are not evidence', () => {
        expect(significantWords('baguette de pain')).toEqual([
            'baguette',
            'pain',
        ]);
        // A two-letter name still needs an exact word match instead of being
        // dropped as unprovable.
        expect(nameBackedByTexts('os', ['des os'])).toBe(true);
        expect(nameBackedByTexts('os', ['3L de lait'])).toBe(false);
    });
});

describe('unit evidence', () => {
    test('a unit the user never said is not kept', () => {
        // "5 baguettes de pain": the model answers "pièce", the request does not.
        expect(
            unitMentionedInTexts('pièce', ['ajoute 5 baguettes de pain'])
        ).toBe(false);
        expect(unitMentionedInTexts('L', ['ajoute 5 baguettes de pain'])).toBe(
            false
        );
    });

    test('a spoken unit is kept, whatever its spelling', () => {
        expect(unitMentionedInTexts('L', ['2 litres de lait'])).toBe(true);
        expect(unitMentionedInTexts('L', ['1 litre de lait'])).toBe(true);
        expect(
            unitMentionedInTexts('douzaine', ['une douzaine d oeufs'])
        ).toBe(true);
        expect(
            unitMentionedInTexts('boîte', ['2 boites de thon'])
        ).toBe(true);
    });

    test('unknown units have no aliases and are rejected', () => {
        expect(unitMentionedInTexts('bouche', ['5 baguettes de pain'])).toBe(
            false
        );
    });

    test('a unit that is just the item name is rejected', () => {
        expect(unitContradictsName('boîte', 'boite de thon')).toBe(true);
        expect(unitContradictsName('douzaine', 'oeuf')).toBe(false);
        expect(unitContradictsName(undefined, 'oeuf')).toBe(false);
    });
});

describe('dedupeItems', () => {
    test('collapses duplicate rows and sums their quantities', () => {
        const deduped = dedupeItems([
            item({ name: 'baguette de pain', quantity: 1 }),
            item({ name: 'baguettes de pain', quantity: 5 }),
            item({ name: 'lait', quantity: 2, unit: 'L' }),
        ]);
        expect(deduped).toHaveLength(2);
        expect(deduped[0].quantity).toBe(6);
    });

    test('keeps a row to buy as long as one duplicate is to buy', () => {
        const deduped = dedupeItems([
            item({ name: 'pain', status: 'taken', takenAt: 10 }),
            item({ name: 'pains', quantity: 2 }),
        ]);
        expect(deduped).toHaveLength(1);
        expect(deduped[0].status).toBe('todo');
        expect(deduped[0].takenAt).toBeUndefined();
        expect(deduped[0].quantity).toBe(3);
    });

    test('two taken duplicates stay taken', () => {
        const deduped = dedupeItems([
            item({ name: 'pain', status: 'taken', takenAt: 10 }),
            item({ name: 'pains', status: 'taken', takenAt: 30 }),
        ]);
        expect(deduped[0].status).toBe('taken');
        expect(deduped[0].takenAt).toBe(30);
    });
});

describe('categories', () => {
    test('only known aisles are accepted', () => {
        expect(isGroceryCategory('cremerie')).toBe(true);
        expect(isGroceryCategory('jardinage')).toBe(false);
        expect(isGroceryCategory(null)).toBe(false);
    });

    test('grouping follows the aisle order and drops empty groups', () => {
        const groups = groupByCategory([
            item({ name: 'pommes', category: 'fruits-legumes' }),
            item({ name: 'yaourt', category: 'cremerie' }),
            item({ name: 'mystère' }),
        ]);
        expect(groups.map((g) => g.category)).toEqual([
            'fruits-legumes',
            'cremerie',
            'autre',
        ]);
    });
});

describe('formatQuantity', () => {
    test('renders the spoken/displayed quantity', () => {
        expect(
            formatQuantity(item({ name: 'lait', quantity: 2, unit: 'L' }))
        ).toBe('2 L');
        expect(formatQuantity(item({ name: 'pommes', quantity: 1.5 }))).toBe(
            '1,5'
        );
        expect(formatQuantity(item({ name: 'pain' }))).toBe('');
    });
});
