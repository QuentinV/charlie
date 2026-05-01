import { ProvidersApis, ProvidersApisPlugin } from '../../types';

export function createPlugin(plugin: ProvidersApisPlugin) {
    const apis: ProvidersApis = {
        api: {
            changeDeviceState: async ({ provider, device }, params) => {
                await fetch(`http://${plugin.host}/api/devices/states`, {
                    method: 'POST',
                    body: JSON.stringify({
                        meta: {
                            provider: {
                                host: provider.host,
                                user: provider.user,
                                password: provider.password,
                            },
                            device: {
                                name: device.name,
                                externalId: device.externalId,
                                type: device.type,
                                state: device.state,
                            },
                        },
                        params,
                    }),
                });
                return true;
            },
            getDeviceState: async ({ provider, device }) => {
                const res = await (
                    await fetch(`http://${plugin.host}/api/devices/states`, {
                        method: 'FIND',
                        body: JSON.stringify({
                            meta: {
                                provider: {
                                    host: provider.host,
                                    user: provider.user,
                                    password: provider.password,
                                },
                                device: {
                                    name: device.name,
                                    externalId: device.externalId,
                                    type: device.type,
                                    state: device.state,
                                },
                            },
                        }),
                    })
                ).json();
                return res;
            },
        },
    };

    return apis;
}
