/**
 * Data access for the household shopping list (collection `shopping_lists`).
 *
 * One shared list for the whole home: the active document has a deterministic
 * id (`active-household`), so lazy creation is race-free and the "finish" flow
 * is a single move to an archived document.
 */
import { v4 as uuid } from 'uuid';
import { cs } from '../core/db';
import {
    ShoppingItem,
    ShoppingItemStatus,
    ShoppingList,
    ShoppingProcessing,
    ShoppingRawRequest,
} from '../types';

/** Scope of the list: one household list (see the architecture rules). */
export const HOUSEHOLD_SCOPE = 'household';
/** Deterministic id of the active list. */
export const ACTIVE_LIST_ID = 'active-household';
/** Raw requests are temporary: keep the last N only. */
const MAX_RAW_REQUESTS = 200;

export type RequestSource = ShoppingRawRequest['source'];

function emptyList(at = Date.now()): ShoppingList {
    return {
        _id: ACTIVE_LIST_ID,
        scopeKey: HOUSEHOLD_SCOPE,
        status: 'active',
        createdAt: at,
        updatedAt: at,
        raw: [],
        items: [],
        processing: { state: 'idle' },
    };
}

/** The active list, created on first use. */
export async function getActiveList(): Promise<ShoppingList> {
    const found = await cs.shoppingLists.findOne({ _id: ACTIVE_LIST_ID });
    if (found) {
        return {
            ...emptyList(found.createdAt ?? Date.now()),
            ...found,
            raw: found.raw ?? [],
            items: found.items ?? [],
        } as ShoppingList;
    }

    const doc = emptyList();
    await cs.shoppingLists.updateOne(
        { _id: ACTIVE_LIST_ID },
        { $setOnInsert: doc },
        { upsert: true }
    );
    return (await cs.shoppingLists.findOne({
        _id: ACTIVE_LIST_ID,
    })) as ShoppingList;
}

async function save(list: ShoppingList): Promise<ShoppingList> {
    const updated: ShoppingList = { ...list, updatedAt: Date.now() };
    // Never $set `_id`: Mongo refuses to modify it.
    const { _id, ...fields } = updated;
    await cs.shoppingLists.updateOne(
        { _id: list._id ?? ACTIVE_LIST_ID },
        { $set: fields },
        { upsert: true }
    );
    return updated;
}

// --- raw requests (the temporary list the restructurer consumes) ---

/** Append raw requests (as spoken/typed) and return the created entries. */
export async function addRequests(
    texts: string[],
    source: RequestSource,
    user?: string
): Promise<ShoppingRawRequest[]> {
    const list = await getActiveList();
    const at = Date.now();
    const entries: ShoppingRawRequest[] = (texts ?? [])
        .map((t) => (t ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map((text) => ({
            id: uuid(),
            text,
            at,
            source,
            user,
            processed: false,
        }));

    if (!entries.length) return [];

    list.raw = [...(list.raw ?? []), ...entries].slice(-MAX_RAW_REQUESTS);
    await save(list);
    return entries;
}

export async function getPendingRequests(): Promise<ShoppingRawRequest[]> {
    const list = await getActiveList();
    return (list.raw ?? []).filter((r) => !r.processed);
}

export async function markRawProcessed(ids: string[]): Promise<void> {
    if (!ids?.length) return;
    const list = await getActiveList();
    const done = new Set(ids);
    list.raw = (list.raw ?? []).map((r) =>
        done.has(r.id) ? { ...r, processed: true } : r
    );
    await save(list);
}

export async function setProcessing(
    state: ShoppingProcessing['state'],
    error?: string
): Promise<void> {
    const list = await getActiveList();
    list.processing = { state, lastRunAt: Date.now(), error };
    await save(list);
}

// --- items ---

/** New items always start as `todo`, with a fresh id. */
export function newItem(
    item: Pick<
        ShoppingItem,
        'name' | 'quantity' | 'unit' | 'category' | 'note' | 'user'
    >,
    at = Date.now()
): ShoppingItem {
    return {
        ...item,
        id: uuid(),
        status: 'todo',
        addedAt: at,
    };
}

/** Replace the whole item list (used after a merge). */
export async function replaceItems(items: ShoppingItem[]): Promise<void> {
    const list = await getActiveList();
    list.items = items ?? [];
    await save(list);
}

/**
 * Persist one structuring run in a **single** write: the items, the requests it
 * consumed and its processing state. Items and raw flags therefore move
 * together — a crash can only lose a run (requests stay pending and are
 * retried), never apply one twice, which is what used to bump unrelated rows.
 */
export async function commitRestructure(params: {
    items: ShoppingItem[];
    rawIds?: string[];
    processing?: ShoppingProcessing['state'];
    error?: string;
}): Promise<void> {
    const list = await getActiveList();
    const consumed = new Set(params.rawIds ?? []);
    const updated: ShoppingList = {
        ...list,
        items: params.items ?? [],
        raw: (list.raw ?? []).map((r) =>
            consumed.has(r.id) ? { ...r, processed: true } : r
        ),
        processing: {
            state: params.processing ?? 'idle',
            lastRunAt: Date.now(),
            error: params.error,
        },
        updatedAt: Date.now(),
    };

    const { _id, ...fields } = updated;
    await cs.shoppingLists.updateOne(
        { _id: list._id ?? ACTIVE_LIST_ID },
        { $set: fields },
        { upsert: true }
    );
}

/** Append items to the list (manual add, no structuring involved). */
export async function addItems(items: ShoppingItem[]): Promise<void> {
    if (!items?.length) return;
    const list = await getActiveList();
    list.items = [...(list.items ?? []), ...items];
    await save(list);
}

/** Check / un-check an item: `taken` puts it in the basket, `todo` cancels it. */
export async function setItemStatus(
    itemId: string,
    status: ShoppingItemStatus
): Promise<ShoppingItem | undefined> {
    const list = await getActiveList();
    const item = (list.items ?? []).find((i) => i.id === itemId);
    if (!item) return undefined;
    item.status = status;
    item.takenAt = status === 'taken' ? Date.now() : undefined;
    await save(list);
    return item;
}

/** Item patched by hand (name, quantity, unit, note, category). */
export async function patchItem(
    itemId: string,
    patch: Partial<ShoppingItem>
): Promise<ShoppingItem | undefined> {
    const list = await getActiveList();
    const item = (list.items ?? []).find((i) => i.id === itemId);
    if (!item) return undefined;
    const { id, ...allowed } = patch ?? {};
    void id;
    Object.assign(item, allowed);
    await save(list);
    return item;
}

export async function removeItem(itemId: string): Promise<boolean> {
    const list = await getActiveList();
    const before = (list.items ?? []).length;
    list.items = (list.items ?? []).filter((i) => i.id !== itemId);
    if (list.items.length === before) return false;
    await save(list);
    return true;
}

/** Put every item back in the "to buy" list. Returns how many were moved. */
export async function uncheckAll(): Promise<number> {
    const list = await getActiveList();
    const taken = (list.items ?? []).filter((i) => i.status === 'taken');
    for (const item of taken) {
        item.status = 'todo';
        item.takenAt = undefined;
    }
    if (taken.length) await save(list);
    return taken.length;
}

/** Empty the list without archiving it. */
export async function clearItems(): Promise<number> {
    const list = await getActiveList();
    const count = (list.items ?? []).length;
    if (!count) return 0;
    list.items = [];
    await save(list);
    return count;
}

// --- lifecycle ---

export interface ArchivedSummary {
    /** Items archived: what was in the basket. */
    archived: number;
    /** Items left on the list for the next shopping trip. */
    kept: number;
    archivedAt: number;
}

/**
 * Archive the shopping trip: only the items that were checked (the basket) go
 * to the archive, everything still to buy **stays on the active list** for next
 * time — finishing a trip does not mean abandoning the rest of the list.
 * Returns null when the basket is empty (nothing to archive).
 */
export async function finishList(): Promise<ArchivedSummary | null> {
    const list = await getActiveList();
    const items = list.items ?? [];
    const taken = items.filter((i) => i.status === 'taken');
    const remaining = items.filter((i) => i.status !== 'taken');
    if (!taken.length) return null;

    const archivedAt = Date.now();
    await cs.shoppingLists.insertOne({
        ...list,
        _id: uuid(),
        status: 'archived',
        archivedAt,
        // The archive is the trip: what was bought, and nothing else.
        items: taken,
        raw: [],
        processing: { state: 'idle' } as ShoppingProcessing,
    });

    if (remaining.length) {
        list.items = remaining;
        await save(list);
    } else {
        // Nothing left to buy: a fresh list is created on the next add.
        await cs.shoppingLists.deleteOne({ _id: ACTIVE_LIST_ID });
    }

    return { archived: taken.length, kept: remaining.length, archivedAt };
}

export interface ArchivedList {
    _id: string;
    archivedAt: number;
    /** Items bought during that trip (archives only hold taken items). */
    total: number;
    items: ShoppingItem[];
}

/** Past trips, most recent first (read-only in the UI). */
export async function listHistory(limit = 20): Promise<ArchivedList[]> {
    const docs = await cs.shoppingLists
        .find({ status: 'archived' })
        .sort({ archivedAt: -1 })
        .limit(limit)
        .toArray();

    return docs.map((d: ShoppingList) => {
        const items = d.items ?? [];
        return {
            _id: String(d._id),
            archivedAt: d.archivedAt ?? d.updatedAt ?? 0,
            total: items.length,
            items,
        };
    });
}
