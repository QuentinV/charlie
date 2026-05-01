import 'dotenv/config';
import { init } from './core/db';
import { loadSettingsCache } from './manager/services/settings';
import { fetchProviderApis } from './devices';

export async function initAll() {
    await init();
    await loadSettingsCache();
    await fetchProviderApis();
}
