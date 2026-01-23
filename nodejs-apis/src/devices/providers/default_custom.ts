import { mqttClient } from '../../messaging/receive';
import { ProvidersApis } from '../../types';

const apis: ProvidersApis = {
    api: {
        changeDeviceState: async ({ device: { _id } }, state) => {
            mqttClient.publish(`device/${_id}/state`, JSON.stringify(state), {
                qos: 0,
            });
            return state;
        },
    },
};

export default apis;
