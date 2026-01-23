import { z } from 'zod';
import { cs } from '../../core/db';
import { Device, DeviceState, DeviceTypes, Room } from '../../types';
import {
    callDeviceFunction,
    changeDeviceState,
    getProviderFunctions,
} from '../../devices';
import { NotFoundError } from '../../errors';

interface DeviceChangeStateToolParams extends DeviceState {
    deviceId: string;
}

const [dt0, ...dtrest] = Object.keys(DeviceTypes);

export default async () => {
    const [r0, ...rrest] = (await cs.rooms.find().toArray()).map(
        (r: Room) => r.internalId
    );

    return {
        'fetch-device-list': {
            description:
                'Get home devices list. Can be used to retrieve device ids.',
            inputSchema: {
                // Use specific filters to limit token output
                type: z.enum([dt0, ...dtrest]),
                //    room: z.enum([r0, ...rrest, 'unknown']),
            },
            exec: async ({ type, room }) => {
                console.log('fetch device list', type, room);
                const res = `${(await cs.devices.find({ type }).toArray())
                    .map((d: Device) => `- id: ${d._id} / name: ${d.name}`)
                    .join('\n')}`;
                console.log('result', res);
                return res;
            },
        },
        'change-device-state': {
            description: 'Change an home device state',
            inputSchema: {
                deviceId: z.string(),
                power: z.enum(['on', 'off', 'pause']),
                level: z.optional(
                    z.number({
                        description:
                            'Percentage from 0 to 100. For light brightness, advanced switch,..',
                    })
                ),
            },
            exec: async (params: DeviceChangeStateToolParams) => {
                const res = await changeDeviceState(params.deviceId, params);
                return `Device state ${
                    res ? 'has been changed' : 'failed to change'
                }.`;
            },
        },
        'fetch-devices-state': {
            description: 'Get complete home devices states list.',
            inputSchema: {},
            exec: async () => {
                const res = (await cs.devices.find().toArray()).map(
                    ({ name, type, state }) => ({
                        name,
                        type,
                        state,
                    })
                );
                console.log('result', res);
                return JSON.stringify(res);
            },
        },
        'fetch-device-additional-functions': {
            description: 'Get additional possible functions for a device.',
            inputSchema: {
                deviceId: z.string(),
            },
            exec: async ({ deviceId }) => {
                console.log('fetch-device-additional-functions', deviceId);
                if (!deviceId) throw new NotFoundError(deviceId);
                const functions = await getProviderFunctions(deviceId);
                if (functions) {
                    return functions
                        .map(
                            ({ name: n, params: p, returns: r }) =>
                                `- name: ${n}${
                                    p
                                        ? `/ params: ${JSON.stringify(
                                              p
                                          ).replace(/\\\\/g, '')}`
                                        : ''
                                }${
                                    r
                                        ? ` / returns: ${JSON.stringify(
                                              r
                                          ).replace(/\\\\/g, '')}`
                                        : ''
                                }`
                        )
                        .join('\n');
                }
                return `No additional functions available for this device.`;
            },
        },
        'call-device-additional-function': {
            description:
                'Call additional function with parameters for a device. Functions can be retrieve from fetch-device-additional-functions.',
            inputSchema: {
                deviceId: z.string(),
                functionname: z.string(),
                params: z.any(),
            },
            exec: async ({ deviceId, functionname, params }) => {
                console.log(
                    'call-device-additional-function',
                    functionname,
                    params
                );
                if (!deviceId) throw new NotFoundError(deviceId);
                try {
                    const res = await callDeviceFunction(
                        deviceId,
                        functionname,
                        params
                    );
                    return res !== undefined ? JSON.stringify(res) : 'success';
                } catch (e) {
                    if (e instanceof NotFoundError) {
                        return 'Function does not exist.';
                    }
                    throw e;
                }
            },
        },
        /*'fetch-device-additional-tools': {
            description: 'Get additional tools for a device.', // In case more advanced commands are required than power state change.',
            inputSchema: {
                deviceId: z.string(),
            },
            exec: async ({ deviceId }) => {
                if (!deviceId) throw new NotFoundError(deviceId);
                const device = await cs.devices.findOne({ _id: deviceId });
                const tools = await getProviderTools(device.provider);
                if (tools) {
                    Object.values(tools).forEach((t) => t.instance?.enable());
                }
                // TODO verify it works
            },
        },*/
    };
};
