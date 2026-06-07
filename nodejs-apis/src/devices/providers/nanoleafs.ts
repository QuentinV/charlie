import { NotFoundError } from '../../errors';
import {
    ProviderFunctionDef,
    ProvidersApis,
    DiscoveryResult,
} from '../../types';
import { Bonjour } from 'bonjour-service';

interface ProviderFunctionDefExec extends ProviderFunctionDef {
    exec: (url: string, params: any) => Promise<any>;
}

const functions: ProviderFunctionDefExec[] = [
    {
        name: 'getAvailableEffects',
        returns: ['string'],
        exec: async (url) => (await fetch(`${url}/effects/effectsList`)).json(),
    },
    {
        name: 'setEffect',
        params: { name: 'string' },
        exec: async (url, name) =>
            (
                await fetch(`${url}/effects`, {
                    method: 'PUT',
                    body: JSON.stringify({ select: name }),
                })
            ).json(),
    },
];

async function discoverNanoleafDevices(): Promise<DiscoveryResult> {
    return new Promise((resolve) => {
        const bonjour = new Bonjour();
        const devices: DiscoveryResult['devices'] = [];
        const browser = bonjour.find({ type: 'nanoleaf', protocol: 'tcp' });

        browser.on('up', (service) => {
            const host = service.host ?? service.referer?.address;
            if (host) {
                devices.push({
                    name: service.name,
                    type: 'light',
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
        changeDeviceState: async ({ provider }, { power, level }) => {
            const obj: any = {
                on: { value: power === 'on' },
            };
            if (level !== undefined && obj.on.value) {
                obj.brightness = { value: level };
            }
            await fetch(
                `http://${provider.host}:16021/api/v1/${provider.password}/state`,
                {
                    method: 'PUT',
                    body: JSON.stringify(obj),
                }
            );
            return true;
        },
        getDeviceState: async ({ provider }) => {
            const res = await (
                await fetch(
                    `http://${provider.host}:16021/api/v1/${provider.password}/state`
                )
            ).json();
            return {
                power: res?.on?.value ? 'on' : 'off',
                level: res?.brightness?.value,
            };
        },
        getFunctions: async () => functions,
        callFunction: async ({ provider }, { name, params }) => {
            const func = functions.find((f) => f.name === name);
            if (!func) throw new NotFoundError();
            const url = `http://${provider.host}:16021/api/v1/${provider.password}`;
            return func.exec(url, params);
        },
        publicDiscover: discoverNanoleafDevices,
    },
};

export default apis;
