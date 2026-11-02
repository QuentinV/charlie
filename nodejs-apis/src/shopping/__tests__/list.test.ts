/**
 * List data access: raw requests, item status transitions (the checkbox and its
 * cancel) and the archive lifecycle. Mongo is replaced by an in-memory
 * collection so the suite runs without a database.
 */

let uuidCounter = 0;
jest.mock('uuid', () => ({
    v4: () => `uuid-${++uuidCounter}`,
    v7: () => `uuid-${++uuidCounter}`,
}));

jest.mock('../../core/db', () => {
    const state: { shoppingLists: any[]; writes: number } = {
        shoppingLists: [],
        writes: 0,
    };
    const matches = (doc: any, query: any = {}) =>
        Object.entries(query).every(([key, value]) => doc[key] === value);
    const rowsFor = (query: any) =>
        state.shoppingLists.filter((d) => matches(d, query));

    const cursorFor = (query: any) => {
        let rows = rowsFor(query);
        const cursor: any = {
            sort: (spec: any) => {
                const [key, dir] = Object.entries(spec ?? {})[0] ?? [];
                if (key) {
                    rows = [...rows].sort((a, b) =>
                        (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) *
                        (dir === -1 ? -1 : 1)
                    );
                }
                return cursor;
            },
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
    ACTIVE_LIST_ID,
    addRequests,
    clearItems,
    commitRestructure,
    finishList,
    getActiveList,
    getPendingRequests,
    listHistory,
    markRawProcessed,
    newItem,
    patchItem,
    removeItem,
    replaceItems,
    setItemStatus,
    uncheckAll,
} from '../list';

const db = jest.requireMock('../../core/db') as {
    __state: { shoppingLists: any[]; writes: number };
};

const reset = () => {
    db.__state.shoppingLists.length = 0;
    db.__state.writes = 0;
};

describe('raw requests', () => {
    test('are stored unprocessed, trimmed, with their source', async () => {
        reset();
        const added = await addRequests(['  du lait  ', '', 'du pain'], 'voice');
        expect(added).toHaveLength(2);
        expect(added[0].text).toBe('du lait');
        expect(added[0].source).toBe('voice');
        expect(added[0].processed).toBe(false);
        expect(await getPendingRequests()).toHaveLength(2);
    });

    test('are marked processed once structured, and kept in the document', async () => {
        reset();
        const added = await addRequests(['du lait'], 'ui');
        await markRawProcessed(added.map((r) => r.id));
        expect(await getPendingRequests()).toHaveLength(0);

        const list = await getActiveList();
        expect(list.raw).toHaveLength(1);
        expect(list.raw[0].processed).toBe(true);
    });
});

describe('items', () => {
    test('are created as todo, checked into the basket, then cancelled', async () => {
        reset();
        await replaceItems([
            newItem({ name: 'lait', quantity: 2, unit: 'L' }),
        ]);
        const item = (await getActiveList()).items[0];
        expect(item.status).toBe('todo');

        const taken = await setItemStatus(item.id, 'taken');
        expect(taken?.status).toBe('taken');
        expect(taken?.takenAt).toBeGreaterThan(0);

        const back = await setItemStatus(item.id, 'todo');
        expect(back?.status).toBe('todo');
        expect(back?.takenAt).toBeUndefined();

        expect(await setItemStatus('unknown', 'taken')).toBeUndefined();
    });

    test('uncheckAll only moves what is in the basket', async () => {
        reset();
        const basket = { ...newItem({ name: 'lait' }), status: 'taken' as const };
        await replaceItems([basket, newItem({ name: 'pain' })]);

        expect(await uncheckAll()).toBe(1);
        const items = (await getActiveList()).items;
        expect(items.find((i) => i.name === 'lait')?.status).toBe('todo');
        expect(items.find((i) => i.name === 'pain')?.status).toBe('todo');
    });

    test('can be removed, patched and the list emptied', async () => {
        reset();
        const item = newItem({ name: 'lait' });
        await replaceItems([item]);

        const patched = await patchItem(item.id, {
            name: 'lait demi-écrémé',
            quantity: 3,
        });
        expect(patched?.id).toBe(item.id);
        expect(patched?.quantity).toBe(3);

        expect(await removeItem(item.id)).toBe(true);
        expect(await removeItem('unknown')).toBe(false);

        await replaceItems([newItem({ name: 'pain' })]);
        expect(await clearItems()).toBe(1);
        expect((await getActiveList()).items).toHaveLength(0);
    });
});

describe('commitRestructure', () => {
    test('writes the items and the consumed requests in one update', async () => {
        reset();
        const added = await addRequests(['du lait'], 'voice');
        const writesBefore = db.__state.writes;

        await commitRestructure({
            items: [newItem({ name: 'lait', quantity: 2 })],
            rawIds: added.map((r) => r.id),
        });

        // A single write: items + raw flags + state move together.
        expect(db.__state.writes - writesBefore).toBe(1);

        const list = await getActiveList();
        expect(list.items).toHaveLength(1);
        expect(list.raw.every((r) => r.processed)).toBe(true);
        expect(list.processing?.state).toBe('idle');
    });

    test('leaves the other requests pending', async () => {
        reset();
        const first = await addRequests(['du lait'], 'voice');
        await addRequests(['du pain'], 'voice');

        await commitRestructure({
            items: [newItem({ name: 'lait' })],
            rawIds: first.map((r) => r.id),
        });

        const pending = await getPendingRequests();
        expect(pending).toHaveLength(1);
        expect(pending[0].text).toBe('du pain');
    });
});

describe('lifecycle', () => {
    test('finish archives the basket only and keeps the rest for next time', async () => {
        reset();
        const items = [
            newItem({ name: 'lait' }),
            newItem({ name: 'pain' }),
            newItem({ name: 'pomme' }),
        ];
        await replaceItems(items);
        await setItemStatus(items[0].id, 'taken');
        await setItemStatus(items[1].id, 'taken');

        const archived = await finishList();
        expect(archived).toMatchObject({ archived: 2, kept: 1 });

        // The archive is the trip: what was bought.
        const history = await listHistory();
        expect(history).toHaveLength(1);
        expect(history[0].total).toBe(2);
        expect(history[0].items.map((i) => i.name)).toEqual(['lait', 'pain']);
        expect(history[0].items.every((i) => i.status === 'taken')).toBe(true);

        // What is still to buy stays on the active list.
        const active = await getActiveList();
        expect(active.items.map((i) => i.name)).toEqual(['pomme']);
        expect(active.items[0].status).toBe('todo');

        // The kept line survives later additions (which land as raw requests,
        // structured by the background job).
        await addRequests(['du beurre'], 'voice');
        const after = await getActiveList();
        expect(after.items.map((i) => i.name)).toEqual(['pomme']);
        expect(await getPendingRequests()).toHaveLength(1);
    });

    test('finish empties the list when everything was taken', async () => {
        reset();
        const items = [newItem({ name: 'lait' })];
        await replaceItems(items);
        await setItemStatus(items[0].id, 'taken');

        expect(await finishList()).toMatchObject({ archived: 1, kept: 0 });

        // The active document is gone: a fresh list is created on the next add.
        expect(
            db.__state.shoppingLists.find((d: any) => d._id === ACTIVE_LIST_ID)
        ).toBeUndefined();

        await addRequests(['du beurre'], 'voice');
        const fresh = await getActiveList();
        expect(fresh.items).toHaveLength(0);
        expect(fresh.raw).toHaveLength(1);
        expect(await listHistory()).toHaveLength(1);
    });

    test('an empty basket has nothing to archive', async () => {
        reset();
        expect(await finishList()).toBeNull();

        // Items still to buy do not turn into an archive either.
        await replaceItems([newItem({ name: 'pain' })]);
        expect(await finishList()).toBeNull();
        expect(await listHistory()).toHaveLength(0);
        expect((await getActiveList()).items).toHaveLength(1);
    });
});
