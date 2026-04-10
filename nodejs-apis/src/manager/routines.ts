import { cs } from '../core/db';
import { RestApis } from '../types';
import { v4 as uuidV4 } from 'uuid';

const routes: RestApis = {
    'routines/:id': {
        get: async ({ params }) => cs.routines.findOne({ _id: params.id }),
    },
    'routines/:id/exec': {
        post: async ({ params }) => {
            cs.routines.findOne({ _id: params.id });
        },
    },
    routines: {
        get: async () => cs.routines.find().toArray(),
        post: async ({ body }) => {
            const { _id, name, actions, triggers, active } = body;
            const uuid = _id || uuidV4();
            await cs.routines.updateOne(
                { _id: uuid, name },
                {
                    $set: {
                        _id: uuid,
                        name,
                        actions,
                        active,
                        triggers,
                    },
                },
                { upsert: true }
            );
            return { uuid };
        },
    },
};

export default routes;
