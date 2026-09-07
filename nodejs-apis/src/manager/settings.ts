import { RestApis } from '../types';
import schema from '../settings.schema';
import { flatten, getSettings, updateSettings } from './services/settings';

/** Strip sensitive Home Assistant tokens from the settings payload. */
function redactHaSettings(settings) {
    return Object.entries(settings).reduce((prev, [key, value]) => {
        if (key.startsWith('ha.')) return prev;
        prev[key] = value;
        return prev;
    }, {});
}

const routes: RestApis = {
    settings: {
        get: {
            handler: async () => {
                return {
                    settings: redactHaSettings(flatten(await getSettings())),
                    schema,
                };
            },
        },
        put: {
            handler: async ({ body }) => {
                const settings = body;
                await updateSettings(settings);
            },
        },
    },
};

export default routes;
