import { cs } from '../../core/db';
import { logDeviceState } from '../../devices/history';
import {
    getCachedCapabilities,
    invalidateDeviceCapabilities,
} from '../../devices/capabilities-cache';
import { stateSchemaChanged } from '../../devices/custom-schema';
import { log } from '../../manager/services/activities';

export default {
    'device/state': async (data: string) => {
        log('MQTT', `Received on device/state: ${data}`);
        const { externalId, power, level, properties } = JSON.parse(data);
        if (!externalId) return;

        const device = await cs.devices.findOne({ externalId });
        if (!device) return;

        const nextState = { power, level, properties };
        
        const stale = stateSchemaChanged(
            getCachedCapabilities(device._id)?.state,
            nextState
        );

        await cs.devices.updateOne(
            { _id: device._id },
            { $set: { state: nextState } }
        );

        if (stale) invalidateDeviceCapabilities(device._id);

        await logDeviceState({ externalId });
    },
};
