import { mqttClient } from '../../messaging/receive';
import { ProvidersApis } from '../../types';

/**
 * Default provider for `node-red-charlie-home-assistant` supporting state change through mqtt, receiving state update through mqtt
 */
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
