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
    'shelly/events/rpc': async (data: string) => {
        const { src, method, params } = JSON.parse(data);
        if (method !== 'NotifyStatus' || !params['switch:0']) return;
        const s = params['switch:0'];
        const $set = {};

        if (s.output !== undefined) {
            $set['state.power'] = s.output ? 'on' : 'off';
        }
        if (s.apower !== undefined) {
            $set['state.level'] = s.apower;
        }

        if (Object.keys($set).length) {
            await cs.devices.updateOne({ externalId: src }, { $set });
            await logDeviceState({ externalId: src });
        }
    },
};
