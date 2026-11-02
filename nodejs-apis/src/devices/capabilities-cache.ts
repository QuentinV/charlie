import { DeviceCapabilities } from '../types';

/**
 * In-memory device-capabilities cache, kept until server restart.
 *
 * Lives in its own module (rather than inline in `devices/index.ts`) so the MQTT
 * subscriber can invalidate an entry without importing the whole devices
 * registry — which would create an import cycle (`subscriber → devices/index →
 * providers → messaging/receive`).
 */
const cache = new Map<string, DeviceCapabilities>();

export const getCachedCapabilities = (
    deviceId: string
): DeviceCapabilities | undefined => cache.get(deviceId);

export const setCachedCapabilities = (
    deviceId: string,
    capabilities: DeviceCapabilities
): void => {
    cache.set(deviceId, capabilities);
};

/**
 * Drop a cached result so the next read recomputes it. Custom (`default_custom`)
 * devices derive their schema from the last MQTT state, so a state update must
 * never keep serving the previous vocabulary.
 */
export const invalidateDeviceCapabilities = (deviceId: string): void => {
    cache.delete(deviceId);
};
