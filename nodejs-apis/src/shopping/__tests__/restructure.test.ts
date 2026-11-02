/**
 * Background restructurer: raw requests → items through the small model. The
 * database is in-memory and `fetch` is stubbed, so the suite covers the LLM
 * contract (model/host routing, JSON-schema answer) and both failure paths
 * (requests kept pending, deterministic fallback available).
 */

let uuidCounter = 0;
jest.mock('uuid', () => ({
    v4: () => `uuid-${++uuidCounter}`,
    v7: () => `uuid-${++uuidCounter}`,
}));

jest.mock('../../core/db', () => {
    const state: { shoppingLists: any[]; activities: any[]; writes: number } = {
        shoppingLists: [],
        activities: [],
        writes: 0,
    };
    const matches = (doc: any, query: any = {}) =>
        Object.entries(query).every(([key, value]) => doc[key] === value);
    const rowsFor = (query: any) =>
        state.shoppingLists.filter((d) => matches(d, query));

    const cursorFor = (query: any) => {
        let rows = rowsFor(query);
        const cursor: any = {
            sort: () => cursor,
            limit: (n: number) => {
                rows = rows.slice(0, n);
                return cursor;
            },
            toArray: async () => rows,
        };
        return cursor;
    };

    return {
        __state: state,
        cs: {
            activities: {
                insertOne: async (doc: any) => {
                    state.activities.push(doc);
                    return { insertedId: doc?._id };
                },
            },
            shoppingLists: {
                findOne: async (query: any) => rowsFor(query)[0] ?? null,
                insertOne: async (doc: any) => {
                    state.shoppingLists.push({ ...doc });
                    return { insertedId: doc._id };
                },
                deleteOne: async (query: any) => {
                    const index = state.shoppingLists.findIndex((d) =>
                        matches(d, query)
                    );
                    if (index < 0) return { deletedCount: 0 };
                    state.shoppingLists.splice(index, 1);
                    return { deletedCount: 1 };
                },
                updateOne: async (query: any, patch: any, options: any = {}) => {
                    state.writes++;
                    const doc = rowsFor(query)[0];
                    if (doc) {
                        if (patch.$set) Object.assign(doc, patch.$set);
                        return { modifiedCount: 1 };
                    }
                    if (options?.upsert) {
                        state.shoppingLists.push({
                            ...(patch.$setOnInsert ?? {}),
                            ...(patch.$set ?? {}),
                        });
                        return { upsertedCount: 1 };
                    }
                    return { modifiedCount: 0 };
                },
                find: (query: any = {}) => cursorFor(query),
            },
        },
    };
});

import {
    addRequests,
    getActiveList,
    getPendingRequests,
    newItem,
    replaceItems,
} from '../list';
import { applyFallback, parseLlmContent, restructure, RESTRUCTURE_PROMPT, SHOPPING_ITEMS_SCHEMA } from '../restructure';
import { UNIT_ENUM } from '../items.logic';

const db = jest.requireMock('../../core/db') as {
    __state: { shoppingLists: any[]; activities: any[]; writes: number };
};

let fetchMock: jest.Mock;

/** Successful chat-completion answer carrying the JSON list. */
function answer(items: unknown[]) {
    return {
        ok: true,
        status: 200,
        json: async () => ({
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: JSON.stringify({ items }),
                    },
                },
            ],
        }),
    };
}

beforeEach(() => {
    db.__state.shoppingLists.length = 0;
    db.__state.activities.length = 0;
    db.__state.writes = 0;
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
});

describe('LLM structuring', () => {
    test('turns pending requests into items and clears the pending list', async () => {
        fetchMock.mockResolvedValueOnce(
            answer([
                {
                    name: 'lait',
                    quantity: 2,
                    unit: 'litres',
                    category: 'cremerie',
                    note: 'demi-écrémé',
                },
                { name: 'baguettes', quantity: 2, category: 'boulangerie' },
            ])
        );
        await addRequests(
            ['ajoute 2 litres de lait et 2 baguettes à ma liste de courses'],
            'voice'
        );

        expect(await restructure()).toEqual({ status: 'done', added: 2 });

        const list = await getActiveList();
        expect(list.items.map((i) => i.name)).toEqual(['lait', 'baguettes']);
        expect(list.items[0]).toMatchObject({
            quantity: 2,
            unit: 'L',
            category: 'cremerie',
            note: 'demi-écrémé',
            status: 'todo',
        });
        expect(await getPendingRequests()).toHaveLength(0);
        expect(list.processing?.state).toBe('idle');
    });

    test('asks the small model, on its host, for a schema-constrained answer', async () => {
        fetchMock.mockResolvedValueOnce(answer([]));
        await addRequests(['du lait'], 'voice');
        await restructure();

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(
            `http://${process.env.LLM_SHOPPING_HOST ?? process.env.LLM_HOST}/v1/chat/completions`
        );

        const body = JSON.parse(init.body);
        expect(body.model).toBe(
            process.env.LLM_SHOPPING_MODEL ?? process.env.LLM_MODEL
        );
        expect(body.tools).toEqual([]);
        expect(body.temperature).toBe(0);
        expect(body.max_tokens).toBe(256);
        expect(body.response_format.type).toBe('json_schema');
        expect(
            body.response_format.json_schema.schema.properties.items
        ).toBeDefined();
        const itemSchema =
            body.response_format.json_schema.schema.properties.items.items;
        expect(itemSchema.properties.unit.enum).toContain('douzaine');
        expect(itemSchema.properties.unit.enum).not.toContain('bouche');
        expect(itemSchema.properties.category.enum).toContain('boulangerie');
        expect(body.messages[0].content).toContain('shopping list');
        expect(body.messages[1].content).toContain('lait');
    });

    test('merges into the items already on the list', async () => {
        await replaceItems([newItem({ name: 'lait', quantity: 1, unit: 'L' })]);
        fetchMock.mockResolvedValueOnce(
            answer([{ name: 'lait', quantity: 2, unit: 'L' }])
        );
        await addRequests(['encore 2 litres de lait'], 'voice');

        await restructure();

        const list = await getActiveList();
        expect(list.items).toHaveLength(1);
        expect(list.items[0].quantity).toBe(3);
    });

    test('drops a unit the user never said, and one that repeats the name', async () => {
        fetchMock.mockResolvedValueOnce(
            answer([
                { name: 'baguette de pain', quantity: 5, unit: 'piece' },
                { name: 'boite de thon', quantity: 1, unit: 'boite' },
            ])
        );
        await addRequests(
            ['ajoute 5 baguettes de pain et une boite de thon'],
            'voice'
        );

        await restructure();

        const items = (await getActiveList()).items;
        expect(items).toHaveLength(2);
        expect(items.map((i) => i.unit)).toEqual([undefined, undefined]);
        expect(items[0]).toMatchObject({ name: 'baguette de pain', quantity: 5 });
    });

    test('keeps a unit the user did say', async () => {
        fetchMock.mockResolvedValueOnce(
            answer([{ name: 'lait', quantity: 2, unit: 'L' }])
        );
        await addRequests(['2 litres de lait'], 'voice');

        await restructure();

        expect((await getActiveList()).items[0]).toMatchObject({
            name: 'lait',
            quantity: 2,
            unit: 'L',
        });
    });

    test('the number the user said wins over the model arithmetic', async () => {
        // The model converts "une douzaine" into 12 while keeping the unit.
        fetchMock.mockResolvedValueOnce(
            answer([{ name: 'oeuf', quantity: 12, unit: 'douzaine' }])
        );
        await addRequests(['une douzaine d oeufs'], 'voice');

        await restructure();

        expect((await getActiveList()).items[0]).toMatchObject({
            name: 'oeuf',
            quantity: 1,
            unit: 'douzaine',
        });
    });

    test('never bumps a row the user did not ask for', async () => {
        // Their list already has bread, they only ask for milk, and the model
        // answers with bread too (echoed from its context).
        await replaceItems([
            newItem({ name: 'baguette de pain', quantity: 1 }),
            newItem({ name: 'lait', quantity: 1, unit: 'L' }),
        ]);
        fetchMock.mockResolvedValueOnce(
            answer([
                { name: 'lait', quantity: 3, unit: 'L' },
                { name: 'baguette de pain', quantity: 1 },
            ])
        );
        await addRequests(['3L de lait'], 'voice');

        await restructure();

        const items = (await getActiveList()).items;
        expect(items).toHaveLength(2);
        expect(items.find((i) => i.name === 'lait')).toMatchObject({
            quantity: 4,
            unit: 'L',
        });
        expect(items.find((i) => i.name === 'baguette de pain')?.quantity).toBe(
            1
        );
    });

    test('does not hand the existing list to the model', async () => {
        await replaceItems([
            newItem({ name: 'baguette de pain', quantity: 1 }),
        ]);
        fetchMock.mockResolvedValueOnce(answer([]));
        await addRequests(['3L de lait'], 'voice');

        await restructure();

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.messages[1].content).toBe(
            'Requests to structure:\n- 3L de lait'
        );
        expect(body.messages[1].content).not.toContain('Already on the list');
    });

    test('applies a run in a single write', async () => {
        fetchMock.mockResolvedValueOnce(
            answer([{ name: 'lait', quantity: 3, unit: 'L' }])
        );
        await addRequests(['3L de lait'], 'voice');

        const writesBefore = db.__state.writes;
        await restructure();

        // One write marks the run as running, one commits the items together
        // with the requests it consumed: a crash can never replay a run.
        expect(db.__state.writes - writesBefore).toBe(2);
        expect((await getActiveList()).items).toHaveLength(1);
        expect(await getPendingRequests()).toHaveLength(0);
    });

    test('collapses duplicates already on the list on the next run', async () => {
        await replaceItems([
            newItem({ name: 'baguette de pain', quantity: 1 }),
            newItem({ name: 'baguettes de pain', quantity: 5 }),
        ]);
        fetchMock.mockResolvedValueOnce(answer([]));
        await addRequests(['du beurre'], 'voice');

        await restructure();

        const items = (await getActiveList()).items;
        expect(items).toHaveLength(1);
        expect(items[0].quantity).toBe(6);
    });

    test('keeps the requests pending and reports the failure', async () => {
        fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        await addRequests(['du lait'], 'voice');

        const result = await restructure();
        expect(result.status).toBe('failed');
        expect(result.error).toContain('ECONNREFUSED');

        const list = await getActiveList();
        expect(list.items).toHaveLength(0);
        expect(await getPendingRequests()).toHaveLength(1);
        expect(list.processing?.state).toBe('failed');
    });

    test('rejects an answer that is not an item list', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                choices: [{ message: { content: 'pas du json' } }],
            }),
        });
        await addRequests(['du lait'], 'voice');

        expect((await restructure()).status).toBe('failed');
        expect(await getPendingRequests()).toHaveLength(1);
    });

    test('does nothing when no request is pending', async () => {
        expect(await restructure()).toEqual({ status: 'empty' });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('fallback parser', () => {
    test('applies the pending requests verbatim, without the model', async () => {
        await addRequests(['du lait, 2 baguettes'], 'ui');

        expect((await applyFallback()).status).toBe('done');

        const list = await getActiveList();
        expect(list.items.map((i) => i.name)).toEqual(['lait', 'baguette']);
        expect(list.items[1].quantity).toBe(2);
        expect(await getPendingRequests()).toHaveLength(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('is a no-op when nothing is pending', async () => {
        expect(await applyFallback()).toEqual({ status: 'empty' });
    });
});

describe('prompt contract', () => {
    test('asks for a singular name and forbids guessed units', () => {
        expect(RESTRUCTURE_PROMPT).toContain('SINGULAR');
        expect(RESTRUCTURE_PROMPT).toContain('never guess one');
        expect(RESTRUCTURE_PROMPT).toContain('NOT quantity 12');
        expect(RESTRUCTURE_PROMPT).toContain('"5 baguettes de pain"');
    });

    test('the schema only allows known units and categories', () => {
        const item =
            SHOPPING_ITEMS_SCHEMA.properties.items.items.properties;
        expect(item.unit.enum).toEqual(UNIT_ENUM);
        expect(item.category.enum).toContain('boulangerie');
    });
});

describe('parseLlmContent', () => {
    test('accepts a fenced answer', () => {
        expect(parseLlmContent('```json\n{"items":[]}\n```')).toEqual({
            items: [],
        });
    });

    test('accepts a raw answer', () => {
        expect(parseLlmContent('{"items":[{"name":"pain"}]}')).toEqual({
            items: [{ name: 'pain' }],
        });
    });
});
