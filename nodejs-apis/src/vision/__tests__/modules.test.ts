/**
 * The vision registry: the invariants every module must respect, and the one
 * cross-module behaviour shipped in v1 — a recipe's ingredients reaching the
 * household shopping list through the deterministic merge.
 */

// `uuid` v13 is ESM-only and Jest does not transform node_modules.
jest.mock('uuid', () => ({
    v4: () => '00000000-0000-4000-8000-000000000000',
    v7: () => '00000000-0000-7000-8000-000000000000',
}));

// The shopping list writes to Mongo: the module only has to call it.
jest.mock('../../skills/shopping/list', () => ({
    getActiveList: jest.fn(async () => ({
        items: [
            {
                id: 'farine',
                name: 'farine',
                quantity: 250,
                unit: 'g',
                status: 'todo',
                addedAt: 1,
            },
        ],
    })),
    replaceItems: jest.fn(async () => {}),
    newItem: jest.fn((item: any) => ({
        ...item,
        id: `${item.name}-new`,
        status: 'todo',
        addedAt: 10,
    })),
}));

import { getActiveList, newItem, replaceItems } from '../../skills/shopping/list';
import {
    VISION_MODULES,
    classifierModules,
    fallbackModule,
    getVisionModule,
    visionModuleCatalogue,
} from '../modules';
import recipe from '../modules/recipe';

describe('vision registry', () => {
    test('every module declares what the pipeline needs', () => {
        for (const [id, module] of Object.entries(VISION_MODULES)) {
            expect(module.id).toBe(id);
            expect(module.label).toBeTruthy();
            expect(module.hint).toBeTruthy();
            expect(typeof module.parse).toBe('function');
            expect(module.prompt.length).toBeGreaterThan(20);
            expect((module.schema as any).type).toBe('object');
        }
    });

    test('every required schema key exists in its own properties', () => {
        for (const module of Object.values(VISION_MODULES)) {
            const properties = (module.schema as any).properties ?? {};
            for (const key of (module.schema as any).required ?? []) {
                expect(properties[key]).toBeDefined();
            }
        }
    });

    test('the classifier sees every module but the fallback', () => {
        const ids = classifierModules().map((m) => m.id);
        expect(ids).toContain('recipe');
        expect(ids).not.toContain('generic');
        expect(fallbackModule().id).toBe('generic');
    });

    test('the catalogue is what a client needs to pick a type', () => {
        const entry = visionModuleCatalogue().find((m) => m.id === 'recipe')!;
        expect(entry.label).toBe('Recette');
        expect(entry.actions).toEqual([
            { id: 'add-to-shopping', label: 'Ajouter aux courses' },
        ]);
        expect(getVisionModule('recipe')).toBe(recipe);
        expect(getVisionModule('nope')).toBeUndefined();
        expect(getVisionModule()).toBeUndefined();
    });

    test('the fallback parses a description and rejects an empty one', () => {
        const generic = fallbackModule();
        expect(generic.parse({ description: ' un ticket de caisse ' })).toEqual(
            { description: 'un ticket de caisse' }
        );
        expect(generic.parse({})).toBeNull();
        expect(generic.parse({ description: '   ' })).toBeNull();
    });
});

describe('recipe → shopping list', () => {
    const action = recipe.actions!.find((a) => a.id === 'add-to-shopping')!;

    beforeEach(() => {
        (getActiveList as jest.Mock).mockClear();
        (replaceItems as jest.Mock).mockClear();
        (newItem as jest.Mock).mockClear();
    });

    test('merges the ingredients into the active list and reports it', async () => {
        const message = await action.run(
            {
                title: 'Crêpes',
                prepTimeS: 0,
                cookTimeS: 0,
                steps: [],
                ingredients: [
                    { name: 'farine', quantity: 500, unit: 'g' },
                    { name: 'lait', quantity: 1, unit: 'L' },
                ],
            },
            { user: 'marie' }
        );

        expect(message).toBe(
            'Added 2 ingredient(s) from "Crêpes" to the shopping list.'
        );

        // The household merge (foldName + unit → quantities summed): the row
        // already on the list is completed, not duplicated.
        const merged = (replaceItems as jest.Mock).mock.calls[0][0];
        expect(merged).toHaveLength(2);
        expect(merged.find((i: any) => i.name === 'farine')).toMatchObject({
            quantity: 750,
            unit: 'g',
        });
        expect(merged.find((i: any) => i.name === 'lait')).toMatchObject({
            quantity: 1,
            unit: 'L',
        });

        // The recognized speaker travels with the items, and only the recipe's
        // ingredients are created (never the existing row).
        expect((newItem as jest.Mock).mock.calls).toHaveLength(2);
        expect((newItem as jest.Mock).mock.calls[0][0]).toMatchObject({
            name: 'farine',
            user: 'marie',
        });
    });
});


