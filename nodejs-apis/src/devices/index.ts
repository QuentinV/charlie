import { cs } from '../core/db';
import { NotFoundError } from '../errors';
import {
    Device,
    DeviceState,
    Provider,
    ProviderApi,
    ProviderFunctionDef,
    ProvidersApis,
    ProvidersApisPlugin,
    RestApis,
    Tools,
} from '../types';
import { log } from '../manager/services/activities';
import { createPlugin } from './providers/plugin';
import defaultProviders from './providers';

type ProvidersApisByName = { [name: string]: ProvidersApis };

type ProvidersDevicesApis = {
    provider: Provider;
    api: ProviderApi;
};

export async function providersApis(): Promise<ProvidersApisByName> {
    const providers = await cs.plugins.find({ type: 'provider' }).toArray();
    return {
        ...providers.reduce(
            (prev, p: ProvidersApisPlugin) => {
                prev[p.name] = createPlugin(p);
                return prev;
            },
            {} as { [key: string]: ProvidersApisPlugin }
        ),
        ...defaultProviders,
    };
}

export async function getProviderTools(id: string) {
    const provider = await cs.providers.findOne({ _id: id });
    return (await providersApis())[provider.codesource]?.tools;
}

export async function getProvidersApis(
    filter?: (api?: ProvidersDevicesApis) => boolean
): Promise<ProvidersDevicesApis[]> {
    const pa = await providersApis();
    let apis = (await cs.providers.find().toArray()).map((p: Provider) => ({
        api: pa[p.codesource]?.api,
        provider: p,
    }));
    if (filter) {
        apis = apis.filter(filter);
    }
    return apis;
}

export async function getProvidersTools(): Promise<Tools> {
    const pa = await providersApis();
    return (await cs.providers.find().toArray()).reduce(
        (prev: Tools, p: Provider) => ({
            ...prev,
            ...pa[p.codesource]?.tools,
        }),
        {}
    );
}

export async function getProvidersRestApis(): Promise<RestApis> {
    const pa = await providersApis();
    return (await cs.providers.find().toArray()).reduce(
        (prev: RestApis, p: Provider) => {
            const def = pa[p.codesource]?.restApi;
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

    const pa = await providersApis();
    const api = pa[provider.codesource].api;
    try {
        await api.init?.(provider);

        if ((await api.isInitialized?.()) ?? true) {
            return await fnt({ device, api, provider });
        }
    } catch (e) {
        log('devices', 'error', {
            context: { deviceId, deviceName: device.name },
            data: JSON.stringify(e),
        });
        return false;
    }
}

export async function getProviderFunctions(
    deviceId: string
): Promise<ProviderFunctionDef[]> {
    log('devices', 'getProviderFunctions', { context: { deviceId } });
    return call(deviceId, ({ device, api, provider }) => {
        if (!api.getFunctions) throw new NotFoundError();
        return api.getFunctions({ device, provider });
    });
}

export async function changeDeviceState(
    deviceId: string,
    params?: DeviceState
) {
    log('devices', 'changeDeviceState', { context: { deviceId, params } });

    const res = await call(deviceId, async ({ device, api, provider }) => {
        const p: DeviceState = params ?? {};
        if (!params && device?.type !== 'button') {
            // button = toggle so no state, everything else reload and inverse previous state if toggle
            const state = await getDeviceState(deviceId);
            p.power = state?.power === 'on' ? 'off' : 'on';
        }

        return api.changeDeviceState?.({ device, provider }, p);
    });

    if (res === true) {
        return getDeviceState(deviceId);
    }
    if (res === false) return false;
    await cs.devices.updateOne({ _id: deviceId }, { $set: { state: res } });
    return res;
}

export async function getDeviceState(
    deviceId: string
): Promise<DeviceState | undefined> {
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

export async function toggleDeviceState(
    deviceId: string
): Promise<boolean | DeviceState | undefined> {
    return changeDeviceState(deviceId);
}

export async function callDeviceFunction(
    deviceId: string,
    functionname: string,
    params: object
): Promise<any> {
    log('devices', 'callDeviceFunction', {
        context: { deviceId, functionname, params },
    });
    return call(deviceId, ({ device, api, provider }) => {
        if (!api.callFunction) throw new NotFoundError();
        return api.callFunction(
            { device, provider },
            { name: functionname, params }
        );
    });
}
