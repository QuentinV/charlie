import { RestApis } from '../types';
import { cs } from '../core/db';
import { listUsers } from '../ai/voiceProfile';

interface MemoryListItem {
    user: string;
    updated: Date | null;
    counts: { preferences: number; facts: number; topics: number };
    hasMemory: boolean;
}

const routes: RestApis = {
    memory: {
        get: {
            handler: async () => {
                const docs = await cs.memories.find({}).toArray();
                const byUser = new Map<string, MemoryListItem>();
                for (const d of docs) {
                    byUser.set(d.user, {
                        user: d.user,
                        updated: d.updated ?? null,
                        counts: {
                            preferences: Object.keys(d.preferences ?? {})
                                .length,
                            facts: (d.facts ?? []).length,
                            topics: Object.keys(d.topics ?? {}).length,
                        },
                        hasMemory: true,
                    });
                }
                // Registered speakers that do not have a memory yet.
                const profiles = await listUsers();
                for (const u of profiles) {
                    if (!byUser.has(u)) {
                        byUser.set(u, {
                            user: u,
                            updated: null,
                            counts: { preferences: 0, facts: 0, topics: 0 },
                            hasMemory: false,
                        });
                    }
                }
                const users = [...byUser.values()].sort((a, b) =>
                    a.user.localeCompare(b.user)
                );
                return { users };
            },
            description: 'List user memory profiles',
        },
    },
    'memory/:user': {
        get: {
            handler: async ({ params }) => {
                const user = decodeURIComponent(params.user);
                const doc = await cs.memories.findOne({ user });
                if (!doc) return null;
                return {
                    user: doc.user,
                    updated: doc.updated ?? null,
                    preferences: doc.preferences ?? {},
                    facts: doc.facts ?? [],
                    topics: doc.topics ?? {},
                    summary: doc.summary,
                };
            },
            description: 'Get a user memory profile',
        },
        delete: {
            handler: async ({ params }) => {
                const user = decodeURIComponent(params.user);
                await cs.memories.deleteOne({ user });
            },
            description: 'Forget a user memory profile',
        },
    },
};

export default routes;
