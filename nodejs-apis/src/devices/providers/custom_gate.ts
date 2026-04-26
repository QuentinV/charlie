import { log } from '../../manager/services/activities';
import { ProvidersApis } from '../../types';

const apis: ProvidersApis = {
    api: {
        changeDeviceState: async ({ provider: { host } }) => {
            try {
                await fetch(`http://${host}/state/toggle`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
            } catch (e) {
                await log('provider-custom_button', e?.toString());
                return false;
            }
            return {};
        },
    },
};

export default apis;
