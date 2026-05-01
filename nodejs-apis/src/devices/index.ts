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
import ikea from './providers/ikea';
import sony_bravia_tv from './providers/sony_bravia_tv';
import nanoleaf from './providers/nanoleafs';
import clim from './providers/clim_mitshubishi';
import customGarden from './providers/custom_garden';
import tuya from './providers/tuya';
import default_custom from './providers/default_custom';
import shelly from './providers/shelly';
import custom_gate from './providers/custom_gate';
import custom_relays from './providers/custom_relays';

// Register all possible providers here
let providerApis: { [name: string]: ProvidersApis } = {};

export let availableProvidersCodeSources: string[] = [];

export async function fetchProviderApis() {
    const providers = await cs.plugins.find({ type: 'provider' }).toArray();

    providerApis = {
        ...providers.reduce(
            (prev, p: ProvidersApisPlugin) => {
                prev[p.name] = createPlugin(p);
                return prev;
            },
            {} as { [key: string]: ProvidersApisPlugin }
        ),
        default_custom,
        ikea,
        sony_bravia_tv,
        nanoleaf,
        clim,
        customGarden,
        tuya,
        shelly,
        custom_gate,
        custom_relays,
    };

    availableProvidersCodeSources = Object.keys(providerApis);

    return providerApis;
}

export async function getProviderTools(id: string) {
    const provider = await cs.providers.findOne({ _id: id });
    return providerApis[provider.codesource]?.tools;
}

type ProvidersDevicesApis = {
    provider: Provider;
    api: ProviderApi;
};

export async function getProvidersApis(
    filter?: (api?: ProvidersDevicesApis) => boolean
): Promise<ProvidersDevicesApis[]> {
    let apis = (await cs.providers.find().toArray()).map((p: Provider) => ({
        api: providerApis[p.codesource]?.api,
        provider: p,
    }));
    if (filter) {
        apis = apis.filter(filter);
    }
    return apis;
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
