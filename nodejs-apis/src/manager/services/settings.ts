import { cs } from '../../core/db';

export type Settings = { [key: string]: string | number | boolean };

export function flatten(obj, prefix = '') {
    let nodes = {};

    for (const key in obj) {
        const path = prefix ? `${prefix}.${key}` : key;

        if (typeof obj[key] === 'object' && obj[key] !== null) {
            // Keep digging
            Object.assign(nodes, flatten(obj[key], path));
        } else {
            nodes[path] = obj[key];
        }
    }

    return nodes;
}

export async function getSettings() {
    return (await cs.settings.findOne({ type: 'global' }))?.settings ?? {};
}

export let settings: { [key: string]: any } = {};
export async function loadSettingsCache() {
    settings = await getSettings();
}

export async function updateSettings(settings: Settings) {
    const s = Object.entries(settings).reduce((prev, [key, value]) => {
        prev[`settings.${key}`] = value;
        return prev;
    }, {});
    await cs.settings.updateOne(
        { type: 'global' },
        { $set: s },
        { upsert: true }
    );
}
