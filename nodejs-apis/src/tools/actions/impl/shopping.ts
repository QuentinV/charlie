/**
 * Tier-1 shopping actions (no LLM): they only append the raw utterance to the
 * list. The background restructurer turns the raw requests into structured
 * items a few seconds later (see `shopping/restructure.ts`), so a voice command
 * answers immediately.
 */
import { Tools } from '../../../types';
import {
    formatQuantity,
    sanitizeRequestText,
} from '../../../shopping/items.logic';
import { addRequests, getActiveList } from '../../../shopping/list';
import {
    restructureDelayMs,
    scheduleRestructure,
    shoppingEnabled,
} from '../../../shopping/restructure';
import { t } from '../langs';

interface ShoppingRequest {
    freeText?: string;
    slots?: { text?: string };
    user?: string;
    sessionId?: string;
}

/** "ajoute du lait à ma liste de courses" → "lait". */
function requestedText(req: ShoppingRequest): string {
    return sanitizeRequestText(req?.slots?.text ?? req?.freeText ?? '');
}

const SPOKEN_MAX_ITEMS = 10;

export const tools: Tools = {
    addShoppingItem: {
        exec: async (req: ShoppingRequest) => {
            if (!shoppingEnabled()) return false;

            const text = requestedText(req);
            if (!text) return false;

            await addRequests([text], 'voice', req?.user);
            // Coalesces a burst of additions into one structuring run.
            scheduleRestructure();

            return t('shopping.added', {
                seconds: Math.round(restructureDelayMs() / 1000),
            });
        },
    },
    askShoppingList: {
        exec: async () => {
            if (!shoppingEnabled()) return false;

            const list = await getActiveList();
            const pending = (list.raw ?? []).filter((r) => !r.processed);
            const items = (list.items ?? []).filter((i) => i.status === 'todo');

            if (!items.length) {
                return pending.length
                    ? t('shopping.pending')
                    : t('shopping.empty');
            }

            const spoken = items
                .slice(0, SPOKEN_MAX_ITEMS)
                .map((i) => {
                    const q = formatQuantity(i);
                    return q ? `${i.name} (${q})` : i.name;
                })
                .join(', ');

            const rest = items.length - SPOKEN_MAX_ITEMS;
            return rest > 0
                ? t('shopping.listMore', { items: spoken, count: rest })
                : t('shopping.list', { items: spoken });
        },
    },
};

export default tools;
