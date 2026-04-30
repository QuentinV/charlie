import { cs } from '../core/db';
import { RestApis } from '../types';
import schema from '../settings.schema';

type Settings = { [key: string]: string | number | boolean };

function flatten(obj, prefix = '') {
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

const routes: RestApis = {
    settings: {
        get: {
            handler: async () => {
                return {
                    settings: flatten(
                        (await cs.settings.findOne({ type: 'global' }))
                            ?.settings ?? {}
                    ),
                    schema,
                };
            },
        },
        put: {
            handler: async ({ body }) => {
                let settings = body;
                settings = Object.entries(settings).reduce(
                    (prev, [key, value]) => {
                        prev[`settings.${key}`] = value;
                        return prev;
                    },
                    {}
                );
                await cs.settings.updateOne(
                    { type: 'global' },
                    { $set: settings },
                    { upsert: true }
                );
            },
        },
    },
};

export default routes;
