import { getProvidersApis, providersApis, ProvidersDevicesApis } from '.';
import { cs } from '../core/db';
import { Device, DiscoveredDevice, DiscoveryResult, Provider } from '../types';

export async function discoverDevices() {
    const existingDevices = await cs.devices.find().toArray();
    const existingProviders = (await cs.providers.find().toArray()).reduce(
        (prev, p) => {
            prev[p._id] = p;
            return prev;
        },
        {}
    );

    const apis = [
        ...(await getProvidersApis(({ api }) => api?.discover)),
        ...Object.entries(await providersApis())
            .filter(([_, pa]) => pa.api?.publicDiscover)
            .map(
                ([codesource, pa]): ProvidersDevicesApis => ({
                    provider: {
                        _id: `virtual-${codesource}`,
                        name: codesource,
                        codesource,
                        type: 'direct',
                    },
                    api: pa.api,
                })
            ),
    ];

    return (
        await Promise.allSettled(
            apis.map(async (a) => {
                const provider: Provider = a.provider;
                let result: DiscoveryResult | undefined;

                if (a.api?.publicDiscover) {
                    result = await a.api.publicDiscover();
                } else if (a.api?.discover) {
                    await a.api?.init?.(provider);
                    result = await a.api.discover(provider);
                }

                const isVirtual = provider._id?.startsWith('virtual-');

                const seenHosts = new Set<string>();
                const filteredDevices = (result?.devices || [])
                    .filter((d: DiscoveredDevice) => {
                        if (!d.host) return true;
                        if (seenHosts.has(d.host)) return false;
                        seenHosts.add(d.host);
                        return true;
                    })
                    .map((d: DiscoveredDevice) => ({
                        ...d,
                        alreadyRegistered: existingDevices.some(
                            (de: Device) =>
                                de.externalId === d.externalId ||
                                (d.host &&
                                    existingProviders[de.provider]?.host ===
                                        d.host) ||
                                (d.mac &&
                                    existingProviders[de.provider]?.mac ===
                                        d.mac)
                        ),
                    }));

                return {
                    provider,
                    publicDiscovery: isVirtual,
                    devices: filteredDevices,
                };
            })
        )
    )
        .map((s: any, i: number) => {
            // If a provider rejects (init/discover failed), surface it as an
            // errored group instead of silently dropping it.
            if (s.status === 'rejected') {
                const entry = apis[i];
                return {
                    provider: entry?.provider,
                    publicDiscovery: entry?.provider?._id?.startsWith(
                        'virtual-'
                    ),
                    devices: [],
                    error: s.reason?.message ?? 'Discovery failed',
                };
            }
            const result = s.value;
            return {
                provider: result?.provider,
                publicDiscovery: result?.publicDiscovery,
                devices: result?.devices ?? [],
                error: undefined,
            };
        })
        .filter((r: any) => r && (r.devices?.length > 0 || r.error));
}
