import { mqttClient } from '../../messaging/receive';
import {
    DeviceCapabilities,
    ProviderApiMetaInfo,
    ProvidersApis,
} from '../../types';
import { deriveStateSchema } from '../custom-schema';

export { deriveStateSchema };

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

            return state.power === 'pause' ? 'off' : state;
        },

        // A custom device declares no schema: advertise the numeric metrics its
        // last MQTT state actually carries.
        getCapabilities: async ({
            device,
        }: ProviderApiMetaInfo): Promise<DeviceCapabilities> => ({
            state: deriveStateSchema(device.state),
            functions: [],
        }),
    },
};

export default apis;
