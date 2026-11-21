/**
 * The scan pipeline, end to end with a fake router: image on disk → classify →
 * extract → a `done` record (or a `failed` one that keeps its image).
 *
 * `fetch` is stubbed with the answers the real model gave (fixtures/), the
 * database is in-memory and the images go to a temp directory, so the suite
 * asserts the *contract* — which calls are made, with which schema, and what the
 * record ends up holding — not the model's judgement.
 */

// `uuid` v13 is ESM-only and Jest does not transform node_modules.
let uuidCounter = 0;
jest.mock('uuid', () => ({
    v4: () => `scan-${++uuidCounter}`,
    v7: () => `scan-${++uuidCounter}`,
}));

// The recipe library writes to Mongo; the filing itself is tested in
// `skills/recipes/__tests__/`.
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

jest.mock('../../manager/services/settings', () => ({
    settings: {},
    loadSettingsCache: async () => {},
}));

jest.mock('../../core/db', () => {
    const state: { visionScans: any[]; activities: any[] } = {
        visionScans: [],
        activities: [],
    };
    const matches = (doc: any, query: any = {}) =>
        Object.entries(query).every(([key, value]) => doc[key] === value);
    const rows = (query: any) => state.visionScans.filter((d) => matches(d, query));

    const cursor = (query: any) => {
        let list = rows(query);
        const c: any = {
            sort: (spec: any) => {
                const [[key, dir]] = Object.entries(spec);
                list = [...list].sort(
                    (a: any, b: any) => (a[key] - b[key]) * (dir as number)
                );
                return c;
            },
            limit: (n: number) => {
                list = list.slice(0, n);
                return c;
            },
            toArray: async () => list,
        };
        return c;
    };

    return {
        __state: state,
        cs: {
            visionScans: {
                find: (query: any) => cursor(query),
                findOne: async (query: any) => rows(query)[0] ?? null,
                insertOne: async (doc: any) => {
                    state.visionScans.push({ ...doc });
                    return { insertedId: doc._id };
                },
                updateOne: async (query: any, patch: any) => {
                    const doc = rows(query)[0];
                    if (doc) Object.assign(doc, patch.$set ?? {});
                    return { modifiedCount: doc ? 1 : 0 };
                },
                deleteOne: async (query: any) => {
                    const i = state.visionScans.findIndex((d) =>
                        matches(d, query)
                    );
                    if (i >= 0) state.visionScans.splice(i, 1);
                    return { deletedCount: i >= 0 ? 1 : 0 };
                },
            },
            activities: {
                insertOne: async (doc: any) => {
                    state.activities.push(doc);
                    return { insertedId: doc._id };
                },
            },
        },
    };
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import * as db from '../../core/db';
import { settings } from '../../manager/services/settings';
import { saveScannedRecipe } from '../../skills/recipes';
import { imagePath } from '../images';
import {
    maxImageMb,
    removeScan,
    rescan,
    runScanAction,
    scanImage,
    scanSource,
    scansToKeep,
} from '../index';
import detectRecipe from './fixtures/detect-recipe.json';
import detectUnknown from './fixtures/detect-unknown.json';
import recipeExtract from './fixtures/recipe-extract.json';

/** The in-memory Mongo of the `core/db` mock (see the factory above). */
const state = (db as any).__state as {
    visionScans: any[];
    activities: any[];
};
const dir = path.join(os.tmpdir(), `charlie-vision-scans-${process.pid}`);
const JPEG = Buffer.from('un jpeg de test');
const realFetch = global.fetch;

interface Call {
    url: string;
    body: any;
}
let calls: Call[];
/** One queued answer per router call, in order. */
let answers: string[];

/** The router: llama.cpp's answer shape, one queued content per call. */
function stubRouter() {
    calls = [];
    answers = [];
    (global as any).fetch = async (url: any, init: any) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        const content = answers.shift();
        return {
            ok: true,
            status: 200,
            json: async () => ({
                choices: content
                    ? [{ message: { role: 'assistant', content } }]
                    : [],
                model: 'qwen3vl-4b',
            }),
        };
    };
}

beforeAll(() => {
    process.env.VISION_IMAGES_DIR = dir;
});

afterAll(() => {
    (global as any).fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.VISION_IMAGES_DIR;
});

beforeEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    state.visionScans.length = 0;
    state.activities.length = 0;
    (settings as any).vision = undefined;
    stubRouter();
});

describe('settings-driven knobs', () => {
    test('have defaults, and read the Vision settings when set', () => {
        expect(scansToKeep()).toBe(50);
        expect(maxImageMb()).toBe(25);
        expect(scanSource('ui')).toBe('ui');
        expect(scanSource('camera')).toBe('camera');
        expect(scanSource('nope')).toBe('api');
        expect(scanSource(undefined)).toBe('api');

        (settings as any).vision = { keepScans: 3, maxImageMb: 8 };
        expect(scansToKeep()).toBe(3);
        expect(maxImageMb()).toBe(8);
    });
});

describe('scan pipeline', () => {
    test('classifies then extracts, and stores the recipe', async () => {
        answers = [JSON.stringify(detectRecipe), JSON.stringify(recipeExtract)];

        const scan = await scanImage(JPEG, 'image/jpeg');

        expect(scan.status).toBe('done');
        expect(scan.type).toBe('recipe');
        expect(scan.typeSource).toBe('detected');
        expect(scan.model).toBe('qwen3vl-4b');
        expect(scan.data.ingredients).toHaveLength(6);
        expect(scan.summary).toContain(
            'Recette « La recette de la pâte à crêpes »'
        );
        expect(scan.timingMs?.detect).toBeGreaterThanOrEqual(0);
        expect(scan.image.hash).toHaveLength(64);

        // Two calls: the classifier (closed enum, tiny answer) then the
        // extraction with the schema of the resolved module.
        expect(calls).toHaveLength(2);
        expect(calls[0].body.model).toBe('qwen3vl-4b');
        expect(calls[0].body.max_tokens).toBe(16);
        expect(
            calls[0].body.response_format.json_schema.schema.properties.type
                .enum
        ).toEqual(['recipe', 'unknown']);
        expect(calls[1].body.response_format.json_schema.name).toBe('recipe');
        expect(calls[1].body.max_tokens).toBe(700);
        expect(
            calls[1].body.response_format.json_schema.schema.properties
                .ingredients.items.properties.unit.enum
        ).toContain('pincee');
        expect(calls[1].body.messages[0].content[0].image_url.url).toMatch(
            /^data:image\/jpeg;base64,/
        );
        expect(calls[1].body.messages[0].content[1].text).toContain(
            'JSON schema:'
        );

        // Record, image and activity log.
        expect(state.visionScans).toHaveLength(1);
        expect(fs.existsSync(imagePath(scan.image.file))).toBe(true);
        expect(
            state.activities.some((a) => a.message === 'Scanned a recipe')
        ).toBe(true);
    });

    test('a forced type skips the classifier', async () => {
        answers = [JSON.stringify(recipeExtract)];

        const scan = await scanImage(JPEG, 'image/jpeg', {
            type: 'recipe',
            source: 'ui',
            user: 'marie',
        });

        expect(calls).toHaveLength(1);
        expect(scan.typeSource).toBe('forced');
        expect(scan.source).toBe('ui');
        expect(scan.user).toBe('marie');
        expect(calls[0].body.response_format.json_schema.name).toBe('recipe');
    });

    test('an unrecognized document is described instead', async () => {
        answers = [
            JSON.stringify(detectUnknown),
            JSON.stringify({ description: ' une clé à molette sur un établi ' }),
        ];

        const scan = await scanImage(JPEG, 'image/jpeg');

        expect(scan.status).toBe('done');
        expect(scan.type).toBe('generic');
        expect(scan.data).toEqual({
            description: 'une clé à molette sur un établi',
        });
        expect(scan.summary).toBe('une clé à molette sur un établi');
        expect(calls[1].body.response_format.json_schema.name).toBe('generic');
    });
});

describe('failures and retries', () => {
    test('an unusable answer fails the scan but keeps the image and the type', async () => {
        answers = [JSON.stringify(detectRecipe), 'je ne sais pas lire'];

        const scan = await scanImage(JPEG, 'image/jpeg');

        expect(scan.status).toBe('failed');
        expect(scan.error).toContain('usable recipe');
        // The classifier's verdict survives, so the retry skips phase 1.
        expect(scan.type).toBe('recipe');
        expect(fs.existsSync(imagePath(scan.image.file))).toBe(true);
        expect(
            state.activities.some((a) =>
                String(a.message).startsWith('Scan failed')
            )
        ).toBe(true);
    });

    test('a rescan re-reads the stored image and reuses the detected type', async () => {
        answers = [
            JSON.stringify(detectRecipe),
            'pas du json',
            JSON.stringify(recipeExtract),
        ];
        const failed = await scanImage(JPEG, 'image/jpeg');
        expect(failed.status).toBe('failed');

        const retried = await rescan(failed._id);

        expect(retried?.status).toBe('done');
        expect(retried?.type).toBe('recipe');
        // 2 calls for the first run + 1 for the retry: no second classifier call.
        expect(calls).toHaveLength(3);
        expect(calls[2].body.response_format.json_schema.name).toBe('recipe');
    });

    test('a rescan can force another type', async () => {
        answers = [
            JSON.stringify(detectRecipe),
            JSON.stringify(recipeExtract),
            JSON.stringify({ description: 'une image floue' }),
        ];
        const scan = await scanImage(JPEG, 'image/jpeg');

        const retried = await rescan(scan._id, { type: 'generic' });

        expect(retried?.type).toBe('generic');
        expect(retried?.typeSource).toBe('forced');
    });

    test('an unknown document type is refused without calling the model', async () => {
        answers = [];
        const scan = await scanImage(JPEG, 'image/jpeg', { type: 'facture' });

        expect(scan.status).toBe('failed');
        expect(scan.error).toContain('unknown document type');
        expect(calls).toHaveLength(0);
    });
});

describe('deletion and actions', () => {
    test('deletes a scan with its image', async () => {
        answers = [JSON.stringify(recipeExtract)];
        const scan = await scanImage(JPEG, 'image/jpeg', { type: 'recipe' });

        expect(await removeScan(scan._id)).toBe(true);
        expect(state.visionScans).toHaveLength(0);
        expect(fs.existsSync(imagePath(scan.image.file))).toBe(false);
        expect(await removeScan(scan._id)).toBe(false);
    });

    test('runs a document action on a stored result', async () => {
        answers = [JSON.stringify(recipeExtract)];
        const scan = await scanImage(JPEG, 'image/jpeg', { type: 'recipe' });

        const result = await runScanAction(scan._id, 'save-to-recipes', {
            user: 'marie',
        });

        expect(result).toEqual({
            ok: true,
            message:
                'Saved "La recette de la pâte à crêpes" in the household recipes.',
        });
        // The document is the identity: the library record points back at the
        // scan, which is what lets the tab link to the recipe afterwards.
        expect(saveScannedRecipe).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'La recette de la pâte à crêpes' }),
            { scanId: scan._id, user: 'marie' }
        );

        expect(await runScanAction(scan._id, 'nope')).toEqual({
            ok: false,
            error: 'unknown action nope',
        });
        expect(await runScanAction('missing', 'save-to-recipes')).toEqual({
            ok: false,
            error: 'scan not found',
        });
    });

    test('refuses an action on a scan that has no result', async () => {
        answers = [JSON.stringify(detectRecipe), 'pas du json'];
        const failed = await scanImage(JPEG, 'image/jpeg');

        expect(await runScanAction(failed._id, 'save-to-recipes')).toEqual({
            ok: false,
            error: 'this scan has no result to act on',
        });
    });
});



