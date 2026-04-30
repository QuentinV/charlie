import 'dotenv/config';
import { init } from './core/db';
import { loadSettingsCache } from './manager/services/settings';

export async function initAll() {
    await init();
    await loadSettingsCache();
}
