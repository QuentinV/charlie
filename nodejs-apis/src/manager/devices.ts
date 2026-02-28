import { cs } from '../core/db';
import {
    callDeviceFunction,
    changeDeviceState,
    getDeviceState,
    getProviderFunctions,
    getProvidersApis,
    toggleDeviceState,
} from '../devices';
import { Device, RestApis } from '../types';
import { v4 as uuidV4 } from 'uuid';
import { manageDeviceRoom } from './services/rooms';

const routes: RestApis = {
    'devices/discover': {
        get: async () => {
            const list = await cs.providers.find().toArray();
            const apis = await getProvidersApis();

            const res = await Promise.allSettled(
                list.map(async (p) => {
                    await apis[p.codesource]?.init?.(p);
                    return {
                        provider: p.name,
                        data: await apis[p.codesource]?.discover?.(p),
                    };
                })
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
    'devices/:id/state/toggle': {
        put: {
            handler: async ({ params }) => {
                const res = await toggleDeviceState(params.id);
                if (typeof res === 'object') return { state: res };
                return { res };
            },
            description: 'Toggle state of a device',
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
    'devices/:id/states': {
        get: {
            handler: async ({ params, query }) => {
                const start = Number(query.start);
                const end = Number(query.end);
                try {
                    return {
                        data: await cs.states
                            .aggregate([
                                {
                                    $match: {
                                        deviceId: params.id,
                                        timestamp: { $gte: start, $lte: end },
                                    },
                                },
                                {
                                    $addFields: {
                                        minute: {
                                            $dateTrunc: {
                                                date: { $toDate: '$timestamp' },
                                                unit: 'minute',
                                                timezone: 'Europe/Paris',
                                            },
                                        },
                                        powerPriority: {
                                            $switch: {
                                                branches: [
                                                    {
                                                        case: {
                                                            $eq: [
                                                                '$state.power',
                                                                'on',
                                                            ],
                                                        },
                                                        then: 3,
                                                    },
                                                    {
                                                        case: {
                                                            $eq: [
                                                                '$state.power',
                                                                'pause',
                                                            ],
                                                        },
                                                        then: 2,
                                                    },
                                                ],
                                                default: 1,
                                            },
                                        },
                                    },
                                },
                                {
                                    $group: {
                                        _id: '$minute',
                                        bestPower: { $max: '$powerPriority' },
                                        avgLevel: { $avg: '$state.level' },
                                    },
                                },
                                {
                                    $addFields: {
                                        power: {
                                            $switch: {
                                                branches: [
                                                    {
                                                        case: {
                                                            $eq: [
                                                                '$bestPower',
                                                                3,
                                                            ],
                                                        },
                                                        then: 'on',
                                                    },
                                                    {
                                                        case: {
                                                            $eq: [
                                                                '$bestPower',
                                                                2,
                                                            ],
                                                        },
                                                        then: 'pause',
                                                    },
                                                ],
                                                default: 'off',
                                            },
                                        },
                                    },
                                },
                                {
                                    $project: {
                                        _id: 0,
                                        timestamp: '$_id',
                                        power: '$power',
                                        level: '$avgLevel',
                                    },
                                },
                                { $sort: { timestamp: 1 } },
                            ])
                            .toArray(),
                    };
                } catch (e) {
                    console.log(e);
                }
            },
            description: 'Historical data of states',
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
            const { name, externalId, provider, type }: Device = body;
            let id = body?._id;

            if (!id && externalId && provider) {
                const device = await cs.devices.findOne({
                    externalId,
                    provider,
                });
                id = device?._id;
            }

            if (!id) {
                id = uuidV4();
            }

            await cs.devices.updateOne(
                { _id: id },
                {
                    $set: {
                        _id: id,
                        name,
                        externalId,
                        provider,
                        type,
                    },
                },
                { upsert: true }
            );

            return { uuid: id };
        },
    },
};

export default routes;
