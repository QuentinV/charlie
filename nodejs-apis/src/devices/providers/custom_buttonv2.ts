import { log } from '../../manager/services/activities';
import { ProvidersApis } from '../../types';

const apis: ProvidersApis = {
    api: {
        toggleDeviceState: async ({
            provider: { host },
            device: { externalId },
        }) => {
            try {
                await fetch(`http://${host}/toggle/${externalId}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
            } catch (e) {
                await log('provider-custom_buttonv2', e?.toString());
                return false;
            }
            return true;
        },
    },
};

export default apis;
