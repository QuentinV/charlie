import {
    SamsungTvRemote,
    Keys,
    getAwakeSamsungDevices,
} from 'samsung-tv-remote';
import { ProviderFunctionDef, ProvidersApis } from '../../types';
import { NotFoundError } from '../../errors';

interface ExtendedProviderFunctionDef extends ProviderFunctionDef {
    domain: string;
    version: string;
    description?: string;
}

const functions: ExtendedProviderFunctionDef[] = [
    {
        name: 'sendPower',
        domain: 'system',
        version: '1.0',
        description: 'Send power key to turn on/off TV',
    },
    {
        name: 'sendKey',
        params: [{ key: 'string' }],
        domain: 'control',
        version: '1.0',
        description: 'Send a remote control key (e.g., KEY_VOLUP, KEY_VOLDOWN)',
    },
    {
        name: 'wakeTV',
        domain: 'system',
        version: '1.0',
        description: 'Wake TV from sleep using Wake-on-LAN',
    },
];

let clientCache: Map<string, SamsungTvRemote> = new Map();

async function getClient(ip: string, mac?: string): Promise<SamsungTvRemote> {
    try {
        const cacheKey = mac || ip;
        if (clientCache.has(cacheKey)) {
            return clientCache.get(cacheKey)!;
        }

        const remote = new SamsungTvRemote({
            ip,
            mac,
            name: 'Charlie Home Assistant',
        });

        clientCache.set(cacheKey, remote);
        return remote;
    } catch (e) {
        console.log('Failed to get Samsung TV client:', e);
        throw e;
    }
}

async function isTvAwake(host: string, mac?: string): Promise<boolean> {
    try {
        const devices = await getAwakeSamsungDevices();
        return devices.some((device) =>
            mac ? device.mac === mac : device.ip === host
        );
    } catch (e) {
        console.log(
            `Failed to check awake state for Samsung TV at ${host}:`,
            e
        );
        return false;
    }
}

const apis: ProvidersApis = {
    api: {
        discover: async () => {
            try {
                const devices = await getAwakeSamsungDevices();
                return devices.map((device) => ({
                    host: device.ip,
                    name: device.friendlyName || `Samsung TV ${device.ip}`,
                    mac: device.mac,
                }));
            } catch (e) {
                console.log('Failed to discover Samsung TVs:', e);
                return [];
            }
        },

        changeDeviceState: async ({ provider: { host, mac } }, { power }) => {
            try {
                const client = await getClient(host!, mac);
                if (power === 'on') {
                    await client.wakeTV();
                    console.log(`Samsung TV at ${host} woken up`);
                } else {
                    await client.sendKey(Keys.KEY_POWER);
                    console.log(`Samsung TV at ${host} power key sent`);
                }
                return true;
            } catch (e) {
                console.log(
                    `Failed to change power state for Samsung TV at ${host}:`,
                    e
                );
                return false;
            }
        },

        getDeviceState: async ({ provider: { host, mac } }) => {
            const awake = await isTvAwake(host!, mac);
            return {
                power: awake ? 'on' : 'off',
            };
        },

        getFunctions: async () => functions,

        callFunction: async ({ provider: { host, mac } }, { name, params }) => {
            const f = functions.find((fn) => fn.name === name);
            if (!f) throw new NotFoundError();

            try {
                const client = await getClient(host!, mac);

                switch (name) {
                    case 'sendPower':
                        await client.sendKey(Keys.KEY_POWER);
                        return { sent: true, key: 'KEY_POWER' };

                    case 'sendKey':
                        if (params?.key && typeof params.key === 'string') {
                            const keyName = params.key as keyof typeof Keys;
                            if (keyName in Keys) {
                                await client.sendKey(Keys[keyName]);
                                return { sent: true, key: params.key };
                            }
                            throw new Error(
                                `Unknown key: ${params.key}. Check Keys object for valid keys.`
                            );
                        }
                        throw new Error('Invalid key parameter');

                    case 'wakeTV':
                        await client.wakeTV();
                        return { woken: true };

                    default:
                        throw new NotFoundError();
                }
            } catch (e) {
                console.log(`Failed to call function ${name}:`, e);
                throw e;
            }
        },
    },
};

export default apis;
