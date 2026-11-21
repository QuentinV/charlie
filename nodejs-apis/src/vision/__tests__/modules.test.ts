/**
 * The vision registry: the invariants every module must respect, and the one
 * cross-module behaviour shipped in v1 — a scanned recipe reaching the
 * household's recipe library (from where its ingredients can reach the shopping
 * list, see `skills/recipes/`).
 */

// `uuid` v13 is ESM-only and Jest does not transform node_modules.
jest.mock('uuid', () => ({
    v4: () => '00000000-0000-4000-8000-000000000000',
    v7: () => '00000000-0000-7000-8000-000000000000',
}));

// The library writes to Mongo: the module only has to call it.
jest.mock('../../skills/recipes', () => ({
    saveScannedRecipe: jest.fn(async (recipe: any, options: any) => ({
        _id: 'recipe-1',
        sourceKey: `scan:${options?.scanId ?? 'x'}`,
        source: 'scan',
        recipe,
        summary: `Recette « ${recipe.title} »`,
        scanId: options?.scanId,
        createdAt: 1,
        updatedAt: 1,
    })),
}));

import { saveScannedRecipe } from '../../skills/recipes';
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
            { id: 'save-to-recipes', label: 'Ajouter aux recettes' },
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

describe('recipe → the household library', () => {
    const action = recipe.actions!.find((a) => a.id === 'save-to-recipes')!;

    beforeEach(() => {
        (saveScannedRecipe as jest.Mock).mockClear();
    });

    test('files the scanned recipe and reports it', async () => {
        const data = {
            title: 'Crêpes',
            prepTimeS: 0,
            cookTimeS: 0,
            steps: [],
            ingredients: [
                { name: 'farine', quantity: 500, unit: 'g' },
                { name: 'lait', quantity: 1, unit: 'L' },
            ],
        };

        const message = await action.run(data, {
            scanId: 'scan-7',
            user: 'marie',
        });

        expect(message).toBe('Saved "Crêpes" in the household recipes.');
        // The recipe goes in as it was read, and the scan id travels with it:
        // it is both the record's identity and the link back to the document.
        expect((saveScannedRecipe as jest.Mock).mock.calls[0]).toEqual([
            data,
            { scanId: 'scan-7', user: 'marie' },
        ]);
    });
});


