import { cs } from '../core/db';
import { NotFoundError } from '../errors';
import { RestApis } from '../types';
import { v4 as uuidV4 } from 'uuid';

const routes: RestApis = {
    'rooms/:id/devices/:did': {
        put: async ({ params }) => {
            const room = await cs.rooms.findOne({ _id: params.id });
            if (!room) throw new NotFoundError();
            const devices = new Set(room.devices);
            devices.add(params.did);
            await cs.rooms.updateOne(
                { _id: params.id },
                { $set: { devices: [...devices] } },
                { upsert: true }
            );
        },
        delete: async ({ params }) => {
            const room = await cs.rooms.findOne({ _id: params.id });
            if (!room) throw new NotFoundError();
            await cs.rooms.updateOne(
                { _id: params.id },
                {
                    $set: {
                        devices: (room.devices ?? []).filter(
                            (d: string) => d !== params.did
                        ),
                    },
                }
            );
        },
    },
    'rooms/:id/devices': {
        get: async ({ params }) => {
            const devices = (await cs.rooms.findOne({ _id: params.id }))
                ?.devices;
            if (!devices) throw new NotFoundError();
            return devices;
        },
    },
    'rooms/:id': {
        get: async ({ params }) => cs.rooms.findOne({ _id: params.id }),
    },
    rooms: {
        get: async () => cs.rooms.find().toArray(),
        post: async ({ body }) => {
            const uuid = uuidV4();
            const { name } = body;
            await cs.rooms.insertOne({ _id: uuid, name });
            return { uuid };
        },
    },
};

export default routes;
