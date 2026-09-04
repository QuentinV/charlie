import Bonjour from 'bonjour-service';
import { log } from '../../manager/services/activities';
import { DiscoveryResult, ProvidersApis } from '../../types';

async function publicDiscover(): Promise<DiscoveryResult> {
    return new Promise((resolve) => {
        const bonjour = new Bonjour();

        const devices: DiscoveryResult['devices'] = [];
        const browser = bonjour.find({ type: 'http' });
        browser.on('up', (service: any) => {
            const host = String(service.host || '').replace(/\.local$/, '');
            if (!host.startsWith('esp-light-')) return;

            devices.push({
                name: host,
                type: 'light',
                externalId: host,
                host: service.addresses[0],
                mac: service.txt?.mac as string | undefined,
            });
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
        publicDiscover,
    },
};

export default apis;
