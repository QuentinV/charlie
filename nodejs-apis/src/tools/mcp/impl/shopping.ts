import { z } from 'zod';
import { Tools } from '../../../types';
import Fuse from 'fuse.js';
import { ShoppingItem, ShoppingList } from '../../../types';
import {
    addRequests,
    getActiveList,
    finishList,
    removeItem,
    setItemStatus,
    uncheckAll,
} from '../../../shopping/list';
import {
    applyFallback,
    restructure,
    scheduleRestructure,
    shoppingEnabled,
} from '../../../shopping/restructure';

/** Best match of a spoken item name among the list items. */
function findItem(list: ShoppingList, name: string): ShoppingItem | undefined {
    const items = list.items ?? [];
    const fuse = new Fuse(items, {
        keys: ['name'],
        threshold: 0.4,
    });
    const needle = (name ?? '').trim();
    const byFuse = needle ? fuse.search(needle)[0]?.item : undefined;
    if (byFuse) return byFuse;
    // A single remaining item is unambiguous even when the name is mangled.
    const open = items.filter((i) => i.status === 'todo');
    return open.length === 1 ? open[0] : undefined;
}

function describe(list: ShoppingList): string {
    const items = list.items ?? [];
    const raw = list.raw ?? [];
    return JSON.stringify({
        toBuy: items.filter((i) => i.status === 'todo').map((i) => i.name),
        inBasket: items.filter((i) => i.status === 'taken').map((i) => i.name),
        beingStructured: raw.filter((r) => !r.processed).map((r) => r.text),
        total: items.length,
    });
}

const tools: Tools = {
    'add-shopping-items': {
        description:
            'Add grocery items to the household shopping list. Pass what the user said, one entry per sentence, verbatim: quantities, units and aisles are extracted automatically in the background. Never invent items.',
        inputSchema: {
            requests: z.array(z.string()),
        },
        exec: async ({ requests }, ctx) => {
            if (!shoppingEnabled()) {
                return 'The shopping list is disabled in the settings.';
            }
            const added = await addRequests(requests ?? [], 'llm', ctx?.user);
            if (!added.length) return 'Nothing to add.';
            scheduleRestructure();
            return `Added ${added.length} request(s) to the shopping list, structuring in progress.`;
        },
    },
    'manage-shopping-list': {
        description:
            'Read or modify the household shopping list: list what is still to buy (toBuy), what is already in the basket (inBasket), mark an item as taken, put it back, remove it, retry the background structuring, or finish (archive) the list.',
        inputSchema: {
            action: z.enum([
                'list',
                'take',
                'untake',
                'remove',
                'uncheck',
                'restructure',
                'finish',
            ]),
            item: z.string().optional(),
        },
        exec: async ({ action, item }) => {
            if (!shoppingEnabled()) {
                return 'The shopping list is disabled in the settings.';
            }

            if (action === 'restructure') {
                await restructure({ force: true });
                return describe(await getActiveList());
            }
            if (action === 'uncheck') {
                const moved = await uncheckAll();
                return `Put ${moved} item(s) back on the list.`;
            }
            if (action === 'finish') {
                const done = await finishList();
                return done
                    ? `Archived ${done.archived} bought item(s); ${done.kept} left on the list for next time.`
                    : 'Nothing in the basket: check the items you took first.';
            }

            const list = await getActiveList();
            const isEmpty = !(list.items ?? []).length;
            const hasPending = (list.raw ?? []).some((r) => !r.processed);
            if (isEmpty && hasPending) {
                // Nothing structured yet: apply the requests as they are.
                await applyFallback();
            }

            if (action === 'list') {
                return describe(await getActiveList());
            }

            const fresh = await getActiveList();
            const match = findItem(fresh, item ?? '');
            if (!match) {
                return `No item matching "${item}" on the list.`;
            }

            if (action === 'remove') {
                await removeItem(match.id);
                return `Removed ${match.name}.`;
            }

            const taken = action === 'take';
            await setItemStatus(match.id, taken ? 'taken' : 'todo');
            return taken
                ? `${match.name} is in the basket.`
                : `${match.name} is back on the list.`;
        },
    },
};

export default tools;
