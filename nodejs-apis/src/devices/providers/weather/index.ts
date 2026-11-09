import { settings } from '../../../manager/services/settings';
import { cs } from '../../../core/db';
import { logDeviceState } from '../../history';
import {
    DeviceCapabilities,
    DeviceState,
    DiscoveryResult,
    ProviderApi,
    ProvidersApis,
} from '../../../types';
import {
    WEATHER_STATE_SCHEMA,
    getWeather,
    isConfigured,
    toDeviceState,
} from '../../../weather/service';

/** Stable id shared by the device and by any echo-screen script. */
export const WEATHER_EXTERNAL_ID = 'weather.home';
const DEVICE_NAME = 'Météo';

/**
 * How often the météo device is re-read so its readings reach the state bus on
 * their own. The upstream is only hit once per `WEATHER_CACHE_MS` (10 min), so
 * this costs a cache read; `logDeviceState` then emits only on a real change.
 * It is what lets an automation react to `day_night` (Nuit → Jour) with the
 * ordinary DEVICE_STATE trigger, without a dedicated sun trigger.
 */
const WEATHER_POLL_MS = 5 * 60 * 1000;

/** `$set` on a dotted key stores nested objects; older rows are flat. */
function setting(key: string): any {
    const nested = key
        .split('.')
        .reduce((acc: any, part) => (acc == null ? acc : acc[part]), settings);
    return nested !== undefined ? nested : settings[key];
}

function isEnabled(): boolean {
    return setting('devices.providers.weather.enabled') !== false;
}

const api: ProviderApi = {
    init: async () => isConfigured(),

    publicDiscover: async (): Promise<DiscoveryResult> => {
        if (!isEnabled() || !isConfigured()) return { devices: [] };
        return {
            devices: [
                {
                    name: DEVICE_NAME,
                    type: 'sensor',
                    externalId: WEATHER_EXTERNAL_ID,
                },
            ],
        };
    },

    // Read-only source: the state is whatever the service last fetched.
    getDeviceState: async (): Promise<DeviceState> => {
        const reading = await getWeather();
        return reading ? toDeviceState(reading) : {};
    },

    getCapabilities: async (): Promise<DeviceCapabilities> => ({
        state: WEATHER_STATE_SCHEMA,
        functions: [],
    }),

    // Telemetry is never written back to the upstream.
    changeDeviceState: async () => false,
};

/**
 * Re-read the météo device and publish it. Only the state is written: the
 * provider's own `getDeviceState` returns the (cached) reading, and routing
 * through `devices/index` would create a provider import cycle.
 */
export async function refreshWeatherDevice(): Promise<void> {
    const device = await cs.devices.findOne({ externalId: WEATHER_EXTERNAL_ID });
    if (!device?._id) return;
    const state = await api.getDeviceState?.({ device } as any);
    if (!state) return;
    await cs.devices.updateOne({ _id: device._id }, { $set: { state } });
    await logDeviceState({ deviceId: device._id });
}

/**
 * Boot hook: poll the device so its readings (notably `day_night`) reach the
 * state bus without an echo screen having to display it — that is what lets a
 * DEVICE_STATE automation react to the sun coming up.
 */
export async function onBoot(): Promise<void> {
    if (!isEnabled() || !isConfigured()) return;
    const tick = () =>
        refreshWeatherDevice().catch((e) =>
            console.error('[weather] refresh failed:', e?.message ?? e)
        );
    tick();
    const timer = setInterval(tick, WEATHER_POLL_MS);
    timer.unref?.();
}

const apis: ProvidersApis = { api, onBoot };

export default apis;
