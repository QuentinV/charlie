import 'dotenv/config';
import { init } from './core/db';
import { loadSettingsCache } from './manager/services/settings';
import { toolsSchemas } from './tools/mcp';
import { providersApis } from './devices';

export async function initAll() {
    await init();
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
