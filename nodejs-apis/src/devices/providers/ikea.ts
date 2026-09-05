import { TradfriClient, discoverGateway } from 'node-tradfri-client';
import { AccessoryTypes } from 'node-tradfri-client';
import { ProvidersApis, DiscoveryResult } from '../../types';

let client: TradfriClient | null = null;
let initialized = false;

const apis: ProvidersApis = {
    api: {
        init: async ({ host, password }) => {
            if (!host || !password) return false;
            client = new TradfriClient(host);
            client.on('error', async (err) => {
                console.error(
                    'Caught a Tradfri error via event listener:',
                    err.message
                );
            });

            const { identity, psk } = await client.authenticate(password);
            await client.connect(identity, psk);

            let count = 0;
            await client.on('device updated', () => count++).observeDevices();

            initialized = true;
            return true;
        },
        discover: async (): Promise<DiscoveryResult> => ({
            devices: Object.values(client?.devices ?? {}).map(
                ({ name, instanceId, type }: any) => ({
                    name,
                    externalId: String(instanceId),
                    type:
                        type === AccessoryTypes.remote
                            ? 'switch'
                            : type === AccessoryTypes.lightbulb
                              ? 'light'
                              : 'unknown',
                })
            ),
        }),
        changeDeviceState: async (
            { device: { externalId } },
            { power, properties }
        ) => {
            const brightness = properties?.brightness ?? properties?.level;
            return !!client?.operateLight(client?.devices?.[externalId], {
                onOff: power === 'on',
                ...(brightness !== undefined && { dimmer: brightness }),
            });
        },
        getDeviceState: async ({ device: { externalId } }) => {
            const state = client?.devices[externalId]?.lightList[0];
            return {
                power: state?.onOff ? 'on' : 'off',
                level: state?.dimmer ?? 100,
                properties: {
                    brightness: state?.dimmer ?? 100,
                },
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
