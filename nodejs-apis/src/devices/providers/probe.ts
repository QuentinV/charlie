/**
 * This provider is for testing purpose to test real flows.
 * It stores mock state in memory
 */
import { ProvidersApis, DiscoveryResult, DeviceState, PowerType, DiscoveredDevice, DeviceTypes } from '../../types';

const devices: any = {};

const getDeviceState = (externalId: string): DeviceState => {
    if (devices[externalId] === undefined) {
        devices[externalId] = { power: 'off', level: 0 };
    }
    return devices[externalId];
}

const changeDeviceState = (externalId: string, power?: PowerType, level?: number) => {
    devices[externalId] = { power: power ?? 'off', level: level ?? 0 };
    return devices[externalId];
}

const apis: ProvidersApis = {
    api: {
        changeDeviceState: async (
            { device: { externalId } },
            { power, level, properties }
        ) => {
            return changeDeviceState(externalId, power, level);
        },
        getDeviceState: async ({ device: { externalId } }) => {
            return getDeviceState(externalId);
        },
        publicDiscover: async(): Promise<DiscoveryResult> => {
            return {
                devices: [...Array(5)]
                    .filter((d, i) => devices[`ex-prob-${i}`] === undefined)
                    .map((k, i): DiscoveredDevice => ({
                        name: `mock-${i}`,
                        externalId: `ex-prob-${i}`,
                        type: DeviceTypes.light
                    }))
            }
        }
    },
};

export default apis;
