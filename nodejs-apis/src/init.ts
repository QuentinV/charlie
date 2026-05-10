import 'dotenv/config';
import { init } from './core/db';
import { loadSettingsCache } from './manager/services/settings';
import { toolsSchemas } from './tools/mcp';

export async function initAll() {
    await init();
    await loadSettingsCache();
    await toolsSchemas();
}
