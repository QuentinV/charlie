import 'dotenv/config';
import { init } from './core/db';
import { loadSettingsCache } from './manager/services/settings';
import { toolsSchemas } from './tools/mcp';
import { setupHomeAssistant } from './devices/haSync';

export async function initAll() {
    await init();
    await loadSettingsCache();
    await toolsSchemas();

    setupHomeAssistant().catch((e) =>
        console.error('[Home Assistant] setup failed:', e?.message ?? e)
    );
}
