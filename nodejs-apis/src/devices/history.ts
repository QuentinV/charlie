import { cs } from '../core/db';

export const logDeviceState = async (deviceId: string) => {
    const device = await cs.devices.findOne({ deviceId });
    if (device) {
        const { _id, ...res } = device;
        cs.states.insertOne({
            timestamp: Date.now(),
            deviceId: _id,
            ...res,
        });
    }
};
