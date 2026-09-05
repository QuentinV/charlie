import { cs } from '../../core/db';
import { logDeviceState } from '../../devices/history';
import { log } from '../../manager/services/activities';

export default {
    'device/state': async (data: string) => {
        log('MQTT', `Received on device/state: ${data}`);
        const { externalId, power, level } = JSON.parse(data);
        if (!externalId) return;

        await cs.devices.updateOne(
            { externalId },
            { $set: { state: { power, level } } }
        );

        await logDeviceState({ externalId });
    },
};
