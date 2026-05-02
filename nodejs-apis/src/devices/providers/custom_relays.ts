import { log } from '../../manager/services/activities';
import { ProvidersApis } from '../../types';

const apis: ProvidersApis = {
    api: {
        changeDeviceState: async (
            { provider: { host }, device: { type, externalId } },
            { power }
        ) => {
            let url = `http://${host}/toggle?id=${externalId}`;
            if (type !== 'button') {
                // if button then toggle
                url += `&set=${power === 'on' ? 1 : 0}`;
            }

            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
                const json = await res.json();
                return { power: json?.state === 'high' ? 'on' : 'off' };
            } catch (e) {
                await log('provider-custom_buttonv2', e?.toString());
            }

            return false;
        },
        getDeviceState: async ({
            provider: { host },
            device: { type, externalId },
        }) => {
            if (type !== 'button') {
                try {
                    const res = await fetch(
                        `http://${host}/state?id=${externalId}`,
                        {
                            headers: {
                                'Content-Type': 'application/json',
                            },
                        }
                    );
                    const json = await res.json();
                    return { power: json?.state === 'high' ? 'on' : 'off' };
                } catch (e) {
                    await log('provider-custom_buttonv2', e?.toString());
                }
            }
            return { power: 'off' };
        },
    },
};

export default apis;
