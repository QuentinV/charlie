import { cs } from '../core/db';
import { emitDeviceStateChange } from '../automations/events';

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

/** Previous state per device, so a change can be published as (prev → next). */
const lastState = new Map<string, any>();

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
        const key = String(device._id);
        const signature = fingerprint(device.state);
        if (lastLogged.get(key) === signature) return;
        const prev = lastState.get(key);
        lastLogged.set(key, signature);
        lastState.set(key, device.state);

        // A genuine transition is exactly what the automations bus wants: the
        // two providers that own device events (HA state_changed, MQTT
        // device/state) both funnel through here.
        emitDeviceStateChange(key, prev, device.state);

        const { _id, ...res } = device;
        cs.states.insertOne({
            timestamp: Date.now(),
            deviceId: _id,
            ...res,
        });
    }
};
