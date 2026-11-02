/**
 * REST routes of the household shopping list.
 *
 * Two ways to feed the list: raw `requests` (voice/chat/free text) that a
 * background job structures into items, and a direct `items` add when the user
 * already knows the name/quantity/unit. The tab reads `shopping` and drives the
 * checkbox (`items/:id/status`), the archive (`finish`) and the retry
 * (`requests/apply`, `restructure`).
 */
import { RestApis, ShoppingList } from '../types';
import {
    addItems,
    addRequests,
    clearItems,
    finishList,
    getActiveList,
    listHistory,
    newItem,
    patchItem,
    removeItem,
    setItemStatus,
    uncheckAll,
} from '../shopping/list';
import {
    applyFallback,
    restructure,
    scheduleRestructure,
    shoppingEnabled,
} from '../shopping/restructure';
import { isGroceryCategory, parseQuantity } from '../shopping/items.logic';

/** Payload sent to the UI: pending requests stay visible while being handled. */
function publicList(list: ShoppingList) {
    const items = list.items ?? [];
    return {
        items,
        todo: items.filter((i) => i.status === 'todo').length,
        taken: items.filter((i) => i.status === 'taken').length,
        processing: list.processing ?? { state: 'idle' },
        pending: (list.raw ?? [])
            .filter((r) => !r.processed)
            .map((r) => ({
                id: r.id,
                text: r.text,
                at: r.at,
                source: r.source,
            })),
        updatedAt: list.updatedAt,
    };
}

async function snapshot() {
    return { list: publicList(await getActiveList()) };
}

const routes: RestApis = {
    shopping: {
        get: {
            handler: async () => ({
                enabled: shoppingEnabled(),
                ...(await snapshot()),
            }),
            description: 'Active household shopping list',
        },
    },
    'shopping/history': {
        get: {
            handler: async ({ query }) => ({
                lists: await listHistory(Number(query?.limit) || 20),
            }),
            description: 'Archived shopping lists, most recent first',
            querySchema: { limit: { type: 'number', required: false } },
        },
    },
    // Raw requests: what the user said, structured in the background.
    'shopping/requests': {
        post: {
            handler: async ({ body }) => {
                const texts: string[] = Array.isArray(body?.texts)
                    ? body.texts
                    : body?.text
                      ? [body.text]
                      : [];
                const source =
                    body?.source === 'voice' || body?.source === 'llm'
                        ? body.source
                        : body?.source === 'api'
                          ? 'api'
                          : 'ui';
                const added = await addRequests(texts, source, body?.user);
                if (added.length) scheduleRestructure();
                return { added: added.length, ...(await snapshot()) };
            },
            description: 'Add raw shopping requests (structured in background)',
        },
    },
    // Deterministic parser: used when the structuring model is unavailable.
    'shopping/requests/apply': {
        post: {
            handler: async () => {
                const result = await applyFallback();
                return { result, ...(await snapshot()) };
            },
            description: 'Apply pending requests without the structuring model',
        },
    },
    'shopping/restructure': {
        post: {
            handler: async () => {
                const result = await restructure({ force: true });
                return { result, ...(await snapshot()) };
            },
            description: 'Retry structuring the pending requests',
        },
    },
    // Direct add: name/quantity/unit already known (no model involved).
    'shopping/items': {
        post: {
            handler: async ({ body }) => {
                const name = (body?.name ?? '').trim();
                if (!name) return { error: 'name is required' };

                await addItems([
                    newItem({
                        name,
                        quantity: parseQuantity(body?.quantity),
                        unit: body?.unit?.trim() || undefined,
                        category: isGroceryCategory(body?.category)
                            ? body.category
                            : undefined,
                        note: body?.note?.trim() || undefined,
                        user: body?.user,
                    }),
                ]);
                return await snapshot();
            },
            description: 'Add one shopping item by hand',
        },
    },
    'shopping/items/:id': {
        put: {
            handler: async ({ params, body }) => {
                const item = await patchItem(params.id, {
                    name: body?.name?.trim() || undefined,
                    quantity: parseQuantity(body?.quantity),
                    unit: body?.unit?.trim() || undefined,
                    category: isGroceryCategory(body?.category)
                        ? body.category
                        : undefined,
                    note: body?.note?.trim() || undefined,
                });
                return { item, ...(await snapshot()) };
            },
            description: 'Update a shopping item',
        },
        delete: {
            handler: async ({ params }) => {
                await removeItem(params.id);
                return await snapshot();
            },
            description: 'Remove a shopping item',
        },
    },
    // The checkbox: `taken` puts the item in the basket, `todo` cancels it.
    'shopping/items/:id/status': {
        post: {
            handler: async ({ params, body }) => {
                const item = await setItemStatus(
                    params.id,
                    body?.status === 'taken' ? 'taken' : 'todo'
                );
                return { item, ...(await snapshot()) };
            },
            description: 'Check (in the basket) or cancel a shopping item',
        },
    },
    'shopping/uncheck-all': {
        post: {
            handler: async () => {
                const moved = await uncheckAll();
                return { moved, ...(await snapshot()) };
            },
            description: 'Put every item in the basket back on the list',
        },
    },
    'shopping/clear': {
        post: {
            handler: async () => {
                const cleared = await clearItems();
                return { cleared, ...(await snapshot()) };
            },
            description: 'Empty the shopping list without archiving it',
        },
    },
    'shopping/finish': {
        post: {
            handler: async () => {
                const archived = await finishList();
                return {
                    archived,
                    ...(await snapshot()),
                    history: await listHistory(5),
                };
            },
            description: 'Archive the basket, keep the rest on the list',
        },
    },
};

export default routes;
