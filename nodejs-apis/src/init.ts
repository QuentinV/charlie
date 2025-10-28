import 'dotenv/config';
import { init } from './core/db';

export async function initAll() {
    await init();
}
