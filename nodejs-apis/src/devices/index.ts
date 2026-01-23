import { cs } from '../core/db';
import { NotFoundError } from '../errors';
import {
    Device,
    DeviceState,
    Provider,
    ProviderApi,
    ProviderFunctionDef,
    ProvidersApis,
    RestApis,
    Tools,
} from '../types';

import ikea from './providers/ikea';
import sony_bravia_tv from './providers/sony_bravia_tv';
import nanoleaf from './providers/nanoleafs';
import clim from './providers/clim_mitshubishi';
import customGarden from './providers/custom_garden';
import tuya from './providers/tuya';
import custom_default from './providers/custom_default';

// Register all possible providers here
const providerApis: { [name: string]: ProvidersApis } = {
    custom_default,
    ikea,
    sony_bravia_tv,
    nanoleaf,
    clim,
    customGarden,
    tuya,
};

export const availableProvidersCodeSources = Object.keys(providerApis);

export async function getProviderTools(id: string) {
    const provider = await cs.providers.findOne({ _id: id });
    return providerApis[provider.codesource]?.tools;
}

type ProvidersDevicesApis = {
    [name: string]: ProviderApi;
};

export async function getProvidersApis(): Promise<ProvidersDevicesApis> {
    return (await cs.providers.find().toArray()).reduce(
        (prev: ProvidersDevicesApis, p: Provider) => {
            prev[p.name] = providerApis[p.codesource]?.api;
            return prev;
        },
        {}
    );
}

export async function getProvidersTools(): Promise<Tools> {
    return (await cs.providers.find().toArray()).reduce(
        (prev: Tools, p: Provider) => ({
            ...prev,
            ...providerApis[p.codesource]?.tools,
        }),
        {}
    );
}

export async function getProvidersRestApis(): Promise<RestApis> {
    return (await cs.providers.find().toArray()).reduce(
        (prev: RestApis, p: Provider) => {
            const def = providerApis[p.codesource]?.restApi;
            if (!def) return prev;

            const basePath = p.name.trim().replace(' ', '-').toLowerCase();
            Object.entries(def).forEach(([key, api]) => {
                prev[`${basePath}/${key}`] = api;
            });

            return prev;
        },
        {}
    );
}

async function call(
    deviceId: string,
    fnt: ({
        device,
        api,
        provider,
    }: {
        device: Device;
        api: ProviderApi;
        provider: Provider;
    }) => Promise<any>
): Promise<any> {
    if (!deviceId) throw new NotFoundError(deviceId);

    const device = await cs.devices.findOne({ _id: deviceId });
    if (!device) throw new NotFoundError(deviceId);

    const provider = await cs.providers.findOne({ _id: device.provider });
    if (!provider) throw new NotFoundError(device.provider);

    const api = providerApis[provider.codesource].api;
    await api.init?.(provider);

    if ((await api.isInitialized?.()) ?? true) {
        return fnt({ device, api, provider });
    }
}

export async function getProviderFunctions(
    deviceId: string
): Promise<ProviderFunctionDef[]> {
    console.log('getProviderFunctions', deviceId);
    return call(deviceId, ({ device, api, provider }) => {
        if (!api.getFunctions) throw new NotFoundError();
        return api.getFunctions({ device, provider });
    });
}

export async function changeDeviceState(deviceId: string, params: DeviceState) {
    console.log('changeDeviceState', deviceId, params);
    const res = await call(
        deviceId,
        async ({ device, api, provider }) =>
            !!(await api.changeDeviceState({ device, provider }, params))
    );
    if (res === true) {
        return getDeviceState(deviceId);
    }
    return res;
}

export async function getDeviceState(deviceId: string) {
    return call(deviceId, async ({ device, api, provider }) => {
        if (api.getDeviceState) {
            const state = await api.getDeviceState({ device, provider });
            await cs.devices.updateOne(
                { _id: device._id },
                { $set: { state } }
            );
            return state;
        }
        return device.state;
    });
}

export async function callDeviceFunction(
    deviceId: string,
    functionname: string,
    params: object
): Promise<any> {
    console.log('callDeviceFunction', deviceId, functionname, params);
    return call(deviceId, ({ device, api, provider }) => {
        if (!api.callFunction) throw new NotFoundError();
        return api.callFunction(
            { device, provider },
            { name: functionname, params }
        );
    });
}
