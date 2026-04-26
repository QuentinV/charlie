import { cs } from '../core/db';
import { NotFoundError } from '../errors';
import { execRoutine, restartRoutine, toggleStatusRoutine } from '../routines';
import { RestApis } from '../types';
import { v4 as uuidV4 } from 'uuid';

const routes: RestApis = {
    'routines/:id': {
        get: async ({ params }) => cs.routines.findOne({ _id: params.id }),
    },
    'routines/:id/exec': {
        post: async ({ params }) => {
            const r = await cs.routines.findOne({ _id: params.id });
            const { lastRun } = await execRoutine(r);
            return { lastRun };
        },
    },
    'routines/:id/toggle': {
        post: async ({ params }) => {
            const r = await cs.routines.findOne({ _id: params.id });
            const active = await toggleStatusRoutine(r);
            return { active };
        },
    },
    routines: {
        get: async () => cs.routines.find().toArray(),
        post: async ({ body }) => {
            const { _id, name, actions, triggers } = body;
            const uuid = _id || uuidV4();
            await cs.routines.updateOne(
                { _id: uuid },
                {
                    $set: {
                        _id: uuid,
                        name,
                        actions,
                        triggers,
                    },
                },
                { upsert: true }
            );

            if (_id) {
                restartRoutine(await cs.routines.findOne({ _id: uuid }));
            }

            return { uuid };
        },
    },
};

export default routes;
