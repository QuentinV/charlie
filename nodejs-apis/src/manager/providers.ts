import { cs } from '../core/db';
import { availableProvidersCodeSources } from '../devices';
import { RestApis } from '../types';
import { v4 as uuidV4 } from 'uuid';

const routes: RestApis = {
    'providers/availablesources': {
        get: async () => availableProvidersCodeSources,
    },
    'providers/:id': {
        get: async () => {},
        delete: async () => {},
    },
    providers: {
        get: async () => cs.providers.find().toArray(),
        post: async ({ body }) => {
            const {
                _id,
                name,
                host,
                user,
                password,
                codesource,
                multidevices,
            } = body;
            const uuid = _id || uuidV4();
            await cs.providers.updateOne(
                { _id: uuid, name },
                {
                    $set: {
                        _id: uuid,
                        name,
                        host,
                        user,
                        password,
                        codesource,
                        multidevices,
                    },
                },
                { upsert: true }
            );
            return { uuid };
        },
    },
};

export default routes;
