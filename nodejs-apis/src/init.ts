import 'dotenv/config';
import { init, cs } from './core/db';
import { loadSettingsCache } from './manager/services/settings';
import { toolsSchemas } from './tools/mcp';
import { providersApis } from './devices';
import { bootstrapAccountFromEnv } from './auth/store';
import { ensureServiceToken } from './auth/serviceToken';
import { warmUp } from './ai/llm';
import { resumePending } from './skills/shopping/restructure';

export async function initAll() {
    await init();

    // API tokens are looked up by hash on every authenticated request.
    try {
        await cs.apiTokens.createIndex({ tokenHash: 1 }, { unique: true });
    } catch (e: any) {
        console.error('[DB init] api_tokens index failed:', e?.message ?? e);
    }

    // Archived shopping lists are listed/sorted on every visit to the tab.
    try {
        await cs.shoppingLists.createIndex({ status: 1, archivedAt: -1 });
    } catch (e: any) {
        console.error('[DB init] shopping_lists index failed:', e?.message ?? e);
    }

    // Recipes: the library is searched/sorted on every visit to the tab, and a
    // recipe is looked up by its source key when it is imported again.
    try {
        await cs.recipes.createIndex({ sourceKey: 1 }, { unique: true });
        await cs.recipes.createIndex({ createdAt: -1 });
        await cs.recipes.createIndex({ titleFold: 1 });
    } catch (e: any) {
        console.error('[DB init] recipes index failed:', e?.message ?? e);
    }

    // Vision: the scan history is read newest-first, and filtered by type/status.
    try {
        await cs.visionScans.createIndex({ createdAt: -1 });
        await cs.visionScans.createIndex({ status: 1, createdAt: -1 });
    } catch (e: any) {
        console.error('[DB init] vision_scans index failed:', e?.message ?? e);
    }

    // Break-glass: create the account from env when the settings UI is
    // unreachable (see README → Security).
    await bootstrapAccountFromEnv();

    await loadSettingsCache();

    // Co-located services (vision-feed) read their API token from `.private/`
    // instead of being handed one by hand. Best effort — never block boot.
    ensureServiceToken('vision-feed').catch((e) =>
        console.error('[auth] service token failed:', e?.message ?? e)
    );

    await toolsSchemas();

    // Shopping list: structure the requests a restart left pending, and ask the
    // LLM router to load the models (router mode loads them on demand, so the
    // first voice command would otherwise pay for the load).
    resumePending().catch((e) =>
        console.error('[shopping] resume failed:', e?.message ?? e)
    );
    void warmUp();

    // Providers own their startup hooks (event listeners, row seeding, MQTT
    // wiring…). Run them fire-and-forget so a provider being down never
    // blocks the API boot.
    const apis = await providersApis();
    for (const [name, mod] of Object.entries(apis)) {
        if (typeof mod?.onBoot !== 'function') continue;
        mod.onBoot().catch((e) =>
            console.error(`[providers/${name}] onBoot failed:`, e?.message ?? e)
        );
    }
}
