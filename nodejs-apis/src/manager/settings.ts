import { RestApis } from '../types';
import schema from '../settings.schema';
import { flatten, getSettings, updateSettings } from './services/settings';

const routes: RestApis = {
    settings: {
        get: {
            handler: async () => {
                return {
                    settings: flatten(await getSettings()),
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
