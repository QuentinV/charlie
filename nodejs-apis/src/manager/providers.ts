import { cs } from '../core/db';
import { getMacAddress } from '../core/ipscan';
import { Provider, RestApis } from '../types';
import { v4 as uuidV4 } from 'uuid';
import defaultProviders from '../devices/providers';
import { providersApis } from '../devices';
import {
    providerSettingsUpdate,
    providerSettingsValues,
} from './providerSettings';

const routes: RestApis = {
    'providers/codesources': {
        get: async () => Object.keys(defaultProviders),
    },
    'providers/:id': {
        get: async () => {},
        delete: async () => {},
    },
    'providers/:id/settings': {
        get: {
            handler: async ({ params }) => {
                const provider: Provider | null = await cs.providers.findOne({
                    _id: params.id,
                });
                if (!provider) return { fields: [], values: {} };
                const fields =
                    (await providersApis())[provider.codesource]?.settings ?? [];
                return { fields, values: providerSettingsValues(provider) };
            },
            description:
                'Codesource-specific settings of a provider row (rendered by the providers dialog)',
        },
        put: {
            handler: async ({ params, body }) => {
                const provider: Provider | null = await cs.providers.findOne({
                    _id: params.id,
                });
                if (!provider) return { ok: false, error: 'provider not found' };

                const { host, properties } = providerSettingsUpdate(
                    body?.values ?? body ?? {},
                    provider
                );
                const patch: any = { $set: { properties } };
                if (host) patch.$set.host = host;
                // An emptied host is removed, not stored as ''.
                else patch.$unset = { host: '' };

                await cs.providers.updateOne({ _id: params.id }, patch);
                return {
                    ok: true,
                    values: providerSettingsValues({ ...provider, properties, host }),
                };
            },
            description:
                'Save the codesource-specific settings of a provider row (`url` + `properties`)',
        },
    },
    providers: {
        get: async () => {
            const apis = await providersApis();
            return (await cs.providers.find().toArray()).map(
                (p: Provider) => ({
                    ...p,
                    /** The row exposes a settings dialog for its codesource. */
                    hasSettings: !!apis[p.codesource]?.settings?.length,
                })
            );
        },
        post: async ({ body }) => {
            const {
                _id,
                name,
                host,
                user,
                mac,
                password,
                codesource,
                multidevices,
                type,
                properties,
            } = body;
            const uuid = _id || uuidV4();

            let macAddress = mac;
            if (!macAddress && host?.startsWith('192.168.')) {
                try {
                    macAddress = getMacAddress(host);
                } catch (e) {
                    console.log(e);
                }
            }

            const set: any = {
                _id: uuid,
                name,
                host,
                user,
                mac: macAddress,
                password,
                codesource,
                multidevices,
                type: type || 'gateway',
            };
            
            if (properties !== undefined) {
                set.properties = properties ?? {};
            }

            await cs.providers.updateOne(
                { _id: uuid },
                { $set: set },
                { upsert: true }
            );
            return { uuid };
        },
    },
};

export default routes;
