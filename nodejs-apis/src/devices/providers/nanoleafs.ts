import { NotFoundError } from '../../errors';
import {
    DeviceCapabilities,
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
        inputSchema: [{ key: 'name', label: 'Effet', type: 'string' }],
        exec: async (url, name) =>
            (
                await fetch(`${url}/effects`, {
                    method: 'PUT',
                    body: JSON.stringify({ select: name }),
                })
            ).json(),
    },
];

const capabilities: DeviceCapabilities = {
    stateSchema: [
        {
            key: 'brightness',
            label: 'Luminosité',
            type: 'range',
            unit: '%',
            min: 0,
            max: 100,
            step: 1,
        },
        {
            key: 'hue',
            label: 'Teinte',
            type: 'number',
            min: 0,
            max: 360,
            readonly: true,
        },
        {
            key: 'saturation',
            label: 'Saturation',
            type: 'number',
            unit: '%',
            min: 0,
            max: 100,
            readonly: true,
        },
    ],
    functions,
};

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
        changeDeviceState: async (
            { provider },
            { power, level, properties }
        ) => {
            const obj: any = {
                on: { value: power === 'on' },
            };
            const brightness =
                properties?.brightness ?? (level as number | undefined);
            if (brightness !== undefined && obj.on.value) {
                obj.brightness = { value: brightness };
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
                properties: {
                    brightness: res?.brightness?.value,
                    hue: res?.hue?.value,
                    saturation: res?.saturation?.value,
                },
            };
        },
        getCapabilities: async () => capabilities,
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
