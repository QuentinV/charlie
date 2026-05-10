import 'dotenv/config';
import { init } from './core/db';
import { loadSettingsCache } from './manager/services/settings';
import { initTools } from './tools/mcp';

export async function initAll() {
    await init();
    await loadSettingsCache();
    await initTools();
}
