import { settings } from '../../../manager/services/settings';
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

const apis: ProvidersApis = { api };

export default apis;
