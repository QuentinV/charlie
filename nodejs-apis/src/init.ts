import 'dotenv/config';
import { init, cs } from './core/db';
import { loadSettingsCache } from './manager/services/settings';
import { toolsSchemas } from './tools/mcp';
import { providersApis } from './devices';
import { bootstrapAccountFromEnv } from './auth/store';

export async function initAll() {
    await init();

    // API tokens are looked up by hash on every authenticated request.
    try {
        await cs.apiTokens.createIndex({ tokenHash: 1 }, { unique: true });
    } catch (e: any) {
        console.error('[DB init] api_tokens index failed:', e?.message ?? e);
    }

    // Break-glass: create the account from env when the settings UI is
    // unreachable (see README → Security).
    await bootstrapAccountFromEnv();

    await loadSettingsCache();
    await toolsSchemas();

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
