import {
    DeviceCapabilities,
    ProvidersApis,
    DiscoveryResult,
} from '../../types';
import { Bonjour } from 'bonjour-service';
import { cs } from '../../core/db';
import { logDeviceState } from '../history';
import { registerProviderSubscribers } from '../../messaging/subscribers';

// The Shelly provider owns its MQTT event listener: RPC NotifyStatus pushes
// (output/apower) update the matching Charlie device (matched by Shelly ID as
// externalId) + its state history. Defined here instead of the central
// messaging/subscribers so every provider self-describes its wiring.
registerProviderSubscribers({
    'shelly/events/rpc': async (data: string) => {
        const { src, method, params } = JSON.parse(data);
        if (method !== 'NotifyStatus' || !params['switch:0']) return;
        const s = params['switch:0'];
        const $set: Record<string, any> = {};

        if (s.output !== undefined) {
            $set['state.power'] = s.output ? 'on' : 'off';
        }
        if (s.apower !== undefined) {
            $set['state.level'] = s.apower;
        }

        if (Object.keys($set).length) {
            await cs.devices.updateOne({ externalId: src }, { $set });
            await logDeviceState({ externalId: src });
        }
    },
});

const capabilities: DeviceCapabilities = {
    state: [
        {
            key: 'output',
            label: 'État',
            type: 'boolean',
            readonly: true,
        },
        {
            key: 'apower',
            label: 'Puissance',
            type: 'number',
            unit: 'W',
            readonly: true,
        },
        {
            key: 'voltage',
            label: 'Tension',
            type: 'number',
            unit: 'V',
            readonly: true,
        },
        {
            key: 'current',
            label: 'Courant',
            type: 'number',
            unit: 'A',
            readonly: true,
        },
        {
            key: 'temperature',
            label: 'Température',
            type: 'number',
            unit: '°C',
            readonly: true,
        },
    ],
};

async function getDeviceState({ host }: { host: string }) {
    const res = await fetch(`http://${host}/rpc/Switch.GetStatus?id=0`);
    return res.json();
}

async function setDeviceState({
    host,
    state,
}: {
    host: string;
    state: boolean;
}) {
    await fetch(`http://${host}/rpc/Switch.Set`, {
        method: 'POST',
        body: JSON.stringify({
            id: 0,
            on: state,
        }),
        headers: {
            'Content-Type': 'application/json',
        },
    });
    return true;
}

async function discoverShellyDevices(): Promise<DiscoveryResult> {
    return new Promise((resolve) => {
        const bonjour = new Bonjour();
        const devices: DiscoveryResult['devices'] = [];
        const browser = bonjour.find({ type: 'shelly', protocol: 'tcp' });

        browser.on('up', (service) => {
            const host = service.host ?? service.referer?.address;
            if (host) {
                devices.push({
                    name: service.name,
                    type: 'switch',
                    host: host as string,
                    mac: service.txt?.mac as string | undefined,
                });
            }
        });

        setTimeout(() => {
            browser.stop();
            bonjour.destroy();
            resolve({ devices });
        }, 5000);
    });
}

const apis: ProvidersApis = {
    api: {
        changeDeviceState: async ({ provider: { host } }, { power }) =>
            setDeviceState({ host, state: power === 'on' }),
        getDeviceState: async ({ device, provider: { host } }) => {
            const state = await getDeviceState({ host });
            return {
                power: state?.output ? 'on' : 'off',
                additional: state,
            };
        },
        publicDiscover: discoverShellyDevices,
    },
};

export default apis;
