import { mqttClient } from '../../messaging/receive';
import { ProvidersApis } from '../../types';

const apis: ProvidersApis = {
    api: {
        changeDeviceState: async ({ device: { externalId } }, state) => {
            mqttClient.publish(
                `device/${externalId}/state`,
                JSON.stringify(state),
                {
                    qos: 0,
                }
            );
            return state;
        },
    },
};

export default apis;
