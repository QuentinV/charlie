import { cs } from '../core/db';

/**
 * Last state written to `states`, per device.
 *
 * `logDeviceState` is called after every read/notification (echo screens
 * refresh every few seconds, HA pushes state_changed, the weather provider
 * polls), so an unchanged state would insert the same row over and over and
 * blow up both the collection and every chart. A poller that re-reads a stable
 * value is not a state change: skip it.
 *
 * In-memory on purpose — history is a best-effort log, and a restart may
 * legitimately re-log the first sample.
 */
const lastLogged = new Map<string, string>();

const fingerprint = (state: unknown): string => JSON.stringify(state ?? null);

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
        const signature = fingerprint(device.state);
        if (lastLogged.get(String(device._id)) === signature) return;
        lastLogged.set(String(device._id), signature);

        const { _id, ...res } = device;
        cs.states.insertOne({
            timestamp: Date.now(),
            deviceId: _id,
            ...res,
        });
    }
};
