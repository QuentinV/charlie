import { TuyaContext } from '@tuya/tuya-connector-nodejs';
import { ProvidersApis } from '../../types';

let client: TuyaContext = null;

const apis: ProvidersApis = {
    api: {
        init: async ({ user, password }) => {
            if (!user || !password) return false;
            client = new TuyaContext({
                baseUrl: 'https://openapi.tuyaeu.com',
                accessKey: user,
                secretKey: password,
            });
        },
        changeDeviceState: async ({ device: { externalId } }, { power }) =>
            (
                await client.device.changeFreezeState({
                    device_id: externalId,
                    state: power === 'on' ? 1 : 0,
                })
            ).result,
        getDeviceState: async ({ device: { externalId } }) => {
            const state = (
                await client.device.freezeState({ device_id: externalId })
            ).result.state;
            return {
                power: state === 0 ? 'on' : 'off',
            };
        },
        isInitialized: async () => client !== null,
    },
};

export default apis;
