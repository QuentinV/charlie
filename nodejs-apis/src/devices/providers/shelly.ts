import { ProvidersApis, DiscoveryResult } from '../../types';
import { Bonjour } from 'bonjour-service';

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
