import { NotFoundError } from '../../errors';
import { ProviderFunctionDef, ProvidersApis } from '../../types';

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
            if (!functions[name]) throw new NotFoundError();
            const url = `http://${provider.host}:16021/api/v1/${provider.password}`;
            return functions[name].exec(url, params);
        },
    },
};

export default apis;
