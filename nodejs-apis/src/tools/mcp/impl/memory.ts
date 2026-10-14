import { z } from 'zod';
import { Tools } from '../../../types';
import { updateProfile } from '../../../ai/memory';

const tools: Tools = {
    remember: {
        description:
            'Store a durable fact, preference or topic about the current user so it is remembered in future conversations. Use it when the user asks you to remember something or states a lasting preference.',
        inputSchema: {
            section: z.enum(['preference', 'fact', 'topic']),
            key: z.string().optional(),
            value: z.string(),
        },
        exec: async ({ section, key, value }, ctx) => {
            const user = ctx?.user;
            if (!user) return 'No user identified, nothing was stored.';
            await updateProfile(user, (m) => {
                if (section === 'preference' && key) {
                    m.preferences[key] = value;
                } else if (section === 'topic' && key) {
                    m.topics[key] = value;
                } else if (!m.facts.includes(value)) {
                    m.facts.push(value);
                }
            });
            return 'Stored.';
        },
    },
    forget: {
        description: 'Forget something previously remembered about the user.',
        inputSchema: {
            key: z.string().optional(),
            value: z.string().optional(),
        },
        exec: async ({ key, value }, ctx) => {
            const user = ctx?.user;
            if (!user) return 'No user identified, nothing to forget.';
            await updateProfile(user, (m) => {
                if (key && m.preferences[key] != null) {
                    delete m.preferences[key];
                }
                if (key && m.topics[key] != null) {
                    delete m.topics[key];
                }
                if (value) {
                    m.facts = (m.facts ?? []).filter(
                        (f) => !f.toLowerCase().includes(value.toLowerCase())
                    );
                }
            });
            return 'Forgotten.';
        },
    },
};

export default tools;
