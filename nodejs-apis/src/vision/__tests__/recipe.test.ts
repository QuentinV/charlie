/**
 * Recipe module: units, tolerant parsing of the captured answers, summary.
 *
 * The `recipe-extract.json` fixture is the *verbatim* answer of the shipped
 * model for the handwritten crêpe recipe (see fixtures/README.md), so the two
 * habits it revealed are asserted here: a missing duration key and a unit
 * invented for an ingredient the image gives no quantity for.
 */

// `uuid` v13 is ESM-only and Jest does not transform node_modules.
jest.mock('uuid', () => ({
    v4: () => '00000000-0000-4000-8000-000000000000',
    v7: () => '00000000-0000-7000-8000-000000000000',
}));

import { UNIT_ENUM } from '../../skills/shopping/items.logic';
import recipe, {
    RECIPE_SCHEMA,
    RECIPE_UNITS,
    RECIPE_UNIT_LABELS,
    recipeUnitLabel,
} from '../modules/recipe';
import extract from './fixtures/recipe-extract.json';
import freeTextAnswer from './fixtures/recipe-free-text.json';

describe('recipe units', () => {
    test('extend the household vocabulary instead of replacing it', () => {
        // The shopping list's closed enum is the base: a scanned recipe speaks
        // the same unit language as a spoken request.
        for (const unit of UNIT_ENUM) {
            expect(RECIPE_UNITS).toContain(unit);
        }
        expect(RECIPE_UNITS).toContain('cuillere_a_soupe');
        expect(RECIPE_UNITS).toContain('pincee');
    });

    test('stay ASCII tokens, safe for the JSON-schema grammar', () => {
        for (const unit of RECIPE_UNITS) {
            expect(unit).toMatch(/^[\x20-\x7e]+$/);
            expect(unit).not.toContain(' ');
        }
        // Every recipe-only token has a displayed French form.
        expect(RECIPE_UNIT_LABELS.cuillere_a_soupe).toBe('c. à soupe');
        expect(RECIPE_UNIT_LABELS.pincee).toBe('pincée');
    });

    test('the schema enum is exactly the module vocabulary', () => {
        const enumValues =
            RECIPE_SCHEMA.properties.ingredients.items.properties.unit.enum;
        expect(enumValues).toEqual(RECIPE_UNITS);
    });

    test('recipeUnitLabel renders tokens and accepts known free text', () => {
        expect(recipeUnitLabel('cuillere_a_soupe')).toBe('c. à soupe');
        expect(recipeUnitLabel('cuillère à soupe')).toBe('c. à soupe');
        expect(recipeUnitLabel('pincee')).toBe('pincée');
        expect(recipeUnitLabel('pincée')).toBe('pincée');
        expect(recipeUnitLabel('g')).toBe('g');
        expect(recipeUnitLabel('piece')).toBe('pièce');
        // Free-text artifacts of an answer that drifted from the enum (captured:
        // "gr", "litre" — the household vocabulary still recognizes them).
        expect(recipeUnitLabel('gr')).toBe('g');
        expect(recipeUnitLabel('litre')).toBe('L');
        // A word nobody uses as a unit is dropped, never stored.
        expect(recipeUnitLabel('boulet')).toBeUndefined();
        expect(recipeUnitLabel('')).toBeUndefined();
        expect(recipeUnitLabel(undefined)).toBeUndefined();
    });
});

describe('recipe parse (captured answer)', () => {
    const parsed = recipe.parse(extract)!;

    test('keeps the title, the yield and every ingredient', () => {
        expect(parsed).not.toBeNull();
        expect(parsed.title).toBe('La recette de la pâte à crêpes');
        expect(parsed.estimatedFor).toEqual({
            persons: 30,
            quantity: 30,
            name: 'crepes',
        });
        expect(parsed.ingredients).toHaveLength(6);
        expect(parsed.steps).toHaveLength(2);
    });

    test('defaults the duration the model omitted to 0', () => {
        // `cook_time_s` is absent from the captured answer: not required, so the
        // model omits what the image does not say.
        expect(extract).not.toHaveProperty('cook_time_s');
        expect(parsed.cookTimeS).toBe(0);
        expect(parsed.prepTimeS).toBe(0);
    });

    test('drops the unit invented for an ingredient without a quantity', () => {
        // Captured: {"name": "beurre", "quantity": 0, "unit": "piece"} for a
        // bare "du beurre pour la cuisson".
        const beurre = parsed.ingredients.find((i) => i.name === 'beurre')!;
        expect(beurre).toEqual({ name: 'beurre' });
        expect(beurre.quantity).toBeUndefined();
        expect(beurre.unit).toBeUndefined();
    });

    test('renders the closed-enum units of the image', () => {
        expect(parsed.ingredients[0]).toEqual({
            name: 'œufs',
            quantity: 6,
            unit: 'pièce',
        });
        expect(parsed.ingredients[1]).toEqual({
            name: 'sel',
            quantity: 1,
            unit: 'pincée',
        });
        expect(parsed.ingredients[2]).toEqual({
            name: 'farine',
            quantity: 500,
            unit: 'g',
        });
        expect(parsed.ingredients[4]).toEqual({
            name: 'lait',
            quantity: 1,
            unit: 'L',
        });
    });

    test('summarizes for the voice, in French', () => {
        expect(recipe.summarize!(parsed)).toBe(
            'Recette « La recette de la pâte à crêpes » pour 30 personnes, 6 ingrédients, 2 étapes.'
        );
    });
});

describe('recipe parse (tolerance)', () => {
    test('maps the free-text units of an answer that ignored the enum', () => {
        // The parse tolerates what a model drifting from the grammar produces;
        // this is the *captured* evidence of it (fixtures/README.md).
        const parsed = recipe.parse(freeTextAnswer.data)!;
        const byName = Object.fromEntries(
            parsed.ingredients.map((i) => [i.name, i])
        );
        expect(byName.farine).toEqual({
            name: 'farine',
            quantity: 500,
            unit: 'g',
        });
        expect(byName.lait).toEqual({ name: 'lait', quantity: 1, unit: 'L' });
        expect(byName.sel).toEqual({
            name: 'sel',
            quantity: 1,
            unit: 'pincée',
        });
        // An empty unit string is not a unit.
        expect(byName['œufs'].unit).toBeUndefined();
        expect(byName.beurre.note).toBe('pour la cuisson');
    });

    test('accepts numbers sent as strings and trims the strings', () => {
        const parsed = recipe.parse({
            title: '  Tarte  ',
            ingredients: [{ name: '  pomme ', quantity: '4', unit: 'piece' }],
        })!;
        expect(parsed.title).toBe('Tarte');
        expect(parsed.ingredients).toEqual([
            { name: 'pomme', quantity: 4, unit: 'pièce' },
        ]);
        // No estimatedFor at all when the image gives neither number.
        expect(parsed.estimatedFor).toBeUndefined();
    });

    test('rejects an answer with no usable recipe', () => {
        expect(recipe.parse(null)).toBeNull();
        expect(recipe.parse({})).toBeNull();
        expect(recipe.parse({ title: 'Crêpes' })).toBeNull();
        expect(recipe.parse({ title: '  ', ingredients: [] })).toBeNull();
        expect(
            recipe.parse({ title: 'Crêpes', ingredients: [{ name: '  ' }] })
        ).toBeNull();
        expect(
            recipe.parse({ title: 'Crêpes', ingredients: 'farine' })
        ).toBeNull();
    });
});

