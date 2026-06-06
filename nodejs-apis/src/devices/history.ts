import { cs } from '../core/db';

export const logDeviceState = async ({
    externalId,
    deviceId,
}: {
    externalId?: string;
    deviceId?: string;
}) => {
    if (!externalId && !deviceId) return;
    const device = await cs.devices.findOne(
        externalId ? { externalId } : { _id: deviceId }
    );
    if (device) {
        const { _id, ...res } = device;
        cs.states.insertOne({
            timestamp: Date.now(),
            deviceId: _id,
            ...res,
        });
    }
};
