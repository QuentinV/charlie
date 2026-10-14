import { Tools } from '../../../types';
import * as memory from '../../../ai/memory';
import { t } from '../langs';

interface MemoryRequest {
    freeText?: string;
    slots?: { text?: string };
    user?: string;
}

function extractText(req: MemoryRequest): string {
    return (req?.slots?.text ?? req?.freeText ?? '').trim();
}

export const tools: Tools = {
    remember: {
        exec: async (req: MemoryRequest) => {
            const user = req?.user;
            const text = extractText(req);
            if (!user || !text) return false;
            await memory.updateProfile(user, (m) => {
                if (!m.facts.includes(text)) m.facts.push(text);
            });
            return t('memory.remembered');
        },
    },
    forgetMemory: {
        exec: async (req: MemoryRequest) => {
            const user = req?.user;
            if (!user) return false;
            const text = extractText(req);
            await memory.updateProfile(user, (m) => {
                if (text) {
                    m.facts = (m.facts ?? []).filter(
                        (f) => !f.toLowerCase().includes(text.toLowerCase())
                    );
                } else {
                    m.facts = [];
                    m.topics = {};
                    m.summary = undefined;
                }
            });
            return t('memory.forgotten');
        },
    },
};

export default tools;
