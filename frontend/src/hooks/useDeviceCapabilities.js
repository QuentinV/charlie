import { useEffect, useState } from 'react';
import { api } from '../api/charlie';

/**
 * Shared device-capabilities cache.
 *
 * `deviceId -> Promise<capabilities|null>`. A promise is memoized (not its
 * resolved value) so that several components mounting at the same time share
 * a single in-flight HTTP request. Failures are evicted so the next consumer
 * can retry; the cache otherwise lives for the lifetime of the SPA session,
 * mirroring the server-side `capabilitiesCache` in `devices/index.ts`.
 *
 * @type {Map<string, Promise<{ state?: Array<object>, functions?: Array<object> }|null>>}
 */
const cache = new Map();

/**
 * Resolve a device's capabilities, de-duplicating concurrent and repeated
 * calls for the same `deviceId`.
 *
 * @param {string} [deviceId] Device identifier; falsy values resolve to `null`.
 * @param {{ force?: boolean }} [options] `force` bypasses the cached promise.
 * @returns {Promise<object|null>}
 */
export function fetchDeviceCapabilities(deviceId, { force = false } = {}) {
    if (!deviceId) return Promise.resolve(null);
    if (!force && cache.has(deviceId)) return cache.get(deviceId);

    const promise = api(`devices/${deviceId}/capabilities`)
        .then((res) => res ?? null)
        .catch(() => {
            cache.delete(deviceId);
            return null;
        });

    cache.set(deviceId, promise);
    return promise;
}

/**
 * Drop cached capabilities so the next read re-fetches them.
 *
 * @param {string} [deviceId] Device to invalidate; omit to clear everything.
 */
export function invalidateDeviceCapabilities(deviceId) {
    if (deviceId) {
        cache.delete(deviceId);
    } else {
        cache.clear();
    }
}

/**
 * React binding around {@link fetchDeviceCapabilities}: returns the device
 * capabilities (or `null` while loading / on error) and a `loading` flag.
 * Safe to mount in any number of components — they share one request.
 *
 * @param {string} [deviceId]
 * @returns {{ capabilities: object|null, loading: boolean }}
 */
export function useDeviceCapabilities(deviceId) {
    const [capabilities, setCapabilities] = useState(null);
    const [loading, setLoading] = useState(!!deviceId);

    useEffect(() => {
        let alive = true;

        if (!deviceId) {
            setCapabilities(null);
            setLoading(false);
            return () => {
                alive = false;
            };
        }

        setLoading(true);
        fetchDeviceCapabilities(deviceId).then((caps) => {
            if (!alive) return;
            setCapabilities(caps);
            setLoading(false);
        });

        return () => {
            alive = false;
        };
    }, [deviceId]);

    return { capabilities, loading };
}

export default useDeviceCapabilities;
