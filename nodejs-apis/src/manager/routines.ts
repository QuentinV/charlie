import { cs } from '../core/db';
import { NotFoundError } from '../errors';
import { execRoutine } from '../routines';
import { RestApis } from '../types';
import { v4 as uuidV4 } from 'uuid';

const routes: RestApis = {
    'routines/:id': {
        get: async ({ params }) => cs.routines.findOne({ _id: params.id }),
        put: async ({ params, body }) => {
            const r = cs.routines.findOne({ _id: params.id });
            if (!r) throw new NotFoundError(params.id);
            await cs.routines.updateOne(
                { _id: params.id },
                {
                    $set: body,
                }
            );
        },
    },
    'routines/:id/exec': {
        post: async ({ params }) => {
            const r = await cs.routines.findOne({ _id: params.id });
            const { lastRun } = await execRoutine(r);
            return { lastRun };
        },
    },
    routines: {
        get: async () => cs.routines.find().toArray(),
        post: async ({ body }) => {
            const { _id, name, actions, triggers, active } = body;
            const uuid = _id || uuidV4();
            await cs.routines.updateOne(
                { _id: uuid },
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
