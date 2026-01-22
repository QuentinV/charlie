import { cs } from '../core/db';
import {
    callDeviceFunction,
    changeDeviceState,
    getDeviceState,
    getProviderFunctions,
    getProvidersApis,
} from '../devices';
import { Device, RestApis } from '../types';
import { v4 as uuidV4 } from 'uuid';

const routes: RestApis = {
    'devices/discover': {
        get: async () => {
            const list = await cs.providers.find().toArray();
            const apis = await getProvidersApis();

            const res = await Promise.allSettled(
                list.map(async (p) => ({
                    provider: p.name,
                    data: await apis[p.codesource]?.discover?.(p),
                }))
            );
            return res.map((s: any) => s.value);
        },
    },
    'devices/:id/functions': {
        get: {
            handler: async ({ params }) => getProviderFunctions(params.id),
            description: 'Get all functions available of a device',
        },
    },
    'devices/:id/functions/:name': {
        post: {
            handler: async ({ params, body }) =>
                callDeviceFunction(
                    params.id,
                    params.name,
                    Object.keys(body).length ? body : undefined
                ),
            description: 'Call a function of a device',
        },
    },
    'devices/:id/state': {
        get: {
            handler: async ({ params }) => ({
                state: await getDeviceState(params.id),
            }),
            description: 'Request device state and update cache',
        },
        put: {
            handler: async ({ params, body }) => ({
                res: await changeDeviceState(params.id, body),
            }),
            description:
                'Change state of a device (Turn on/off lights, open blinds, play tv..)',
        },
    },
    'devices/:id': {
        get: async ({ params }) => cs.devices.findOne({ _id: params.id }),
        delete: async ({ params }) => cs.devices.deleteOne({ _id: params.id }),
    },
    devices: {
        get: async ({ query }) => {
            const { roomId } = query ?? {};
            let filter = undefined;
            if (roomId) {
                filter = {
                    _id: {
                        $in:
                            (await cs.rooms.findOne({ _id: roomId }))
                                ?.devices ?? [],
                    },
                };
            }
            return cs.devices.find(filter).toArray();
        },
        post: async ({ body }) => {
            const { _id, name, externalId, provider, type }: Device = body;
            const uuid = _id || uuidV4();
            await cs.devices.updateOne(
                { _id: uuid },
                {
                    _id: uuid,
                    name,
                    externalId,
                    provider,
                    type,
                },
                { upsert: true }
            );
            return { uuid };
        },
    },
};

export default routes;
