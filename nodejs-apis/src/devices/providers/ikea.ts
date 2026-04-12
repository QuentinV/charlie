import { TradfriClient, discoverGateway } from 'node-tradfri-client';
import { ProvidersApis } from '../../types';

// https://www.npmjs.com/package/node-tradfri-client

/*
type === AccessoryTypes.remote
                ? DeviceTypes.switch
                : type === AccessoryTypes.lightbulb
                ? DeviceTypes.light
                : DeviceTypes.unknown,*/

let client: TradfriClient | null = null;
let initialized = false;

const apis: ProvidersApis = {
    api: {
        init: async ({ host, password }) => {
            if (!host || !password) return false;
            client = new TradfriClient(host);
            const { identity, psk } = await client.authenticate(password);
            await client.connect(identity, psk);

            let count = 0;
            await client.on('device updated', () => count++).observeDevices();

            initialized = true;
        },
        discover: async () =>
            Object.values(client?.devices ?? {}).map(
                ({ name, instanceId, type }) => ({
                    name,
                    instanceId,
                    type,
                })
            ),
        changeDeviceState: async ({ device: { externalId } }, { power }) =>
            !!client?.operateLight(client?.devices?.[externalId], {
                onOff: power === 'on',
            }),
        getDeviceState: async ({ device: { externalId } }) => {
            const state = client?.devices[externalId]?.lightList[0];
            return {
                power: state?.onOff ? 'on' : 'off',
                level: state?.dimmer ?? 100,
            };
        },
        isInitialized: async () => initialized,
    },
    restApi: {
        discoverGateway: {
            get: async () => discoverGateway(),
        },
    },
};

export default apis;
