// `uuid` ships ESM only and the provider is imported whole here; the id itself
// is irrelevant to what these tests assert (capabilities, state, discovery).
jest.mock('uuid', () => ({
    v4: () => '00000000-0000-4000-8000-000000000000',
}));

import weather from '../weather';
import { settings } from '../../../manager/services/settings';
import {
    WEATHER_STATE_SCHEMA,
    resetWeatherCache,
    setWeatherFetch,
} from '../../../weather/service';

import payload from '../../../weather/__tests__/fixtures/open-meteo-current.json';

/**
 * The weather provider advertises exactly what it can publish: the schema and
 * the state come from the same service, and the fixture is a captured
 * Open-Meteo answer (inventing attribute names is how a suite stays green
 * while the panel renders blank rows).
 */
describe('weather provider', () => {
    const api = weather.api;

    const jsonResponse = (body: unknown, ok = true) =>
        ({ ok, json: async () => body }) as unknown as Response;

    beforeEach(() => {
        setWeatherFetch((async () =>
            jsonResponse(payload)) as unknown as typeof fetch);
        resetWeatherCache();
        settings.weather = { latitude: 48.85, longitude: 2.35 };
    });

    afterEach(() => {
        delete settings.weather;
        resetWeatherCache();
    });

    it('advertises the metric catalogue and no function', async () => {
        const capabilities = await api.getCapabilities!({} as any);

        expect(capabilities.state).toEqual(WEATHER_STATE_SCHEMA);
        expect(capabilities.functions).toEqual([]);
        // Telemetry is read-only: the schema never offers a write.
        expect(WEATHER_STATE_SCHEMA.every((field) => field.readonly)).toBe(true);
    });

    it('publishes a state that makes every advertised property readable', async () => {
        const state = await api.getDeviceState!({} as any);

        expect(state.level).toBe(9.8);
        for (const field of WEATHER_STATE_SCHEMA) {
            const value =
                field.key === 'level'
                    ? state.level
                    : state.properties?.[field.key];
            expect(value).not.toBeUndefined();
            expect(value).not.toBeNull();
        }

        expect(state.properties?.condition).toBe('Principalement dégagé');
        expect(state.properties?.wind_direction).toBe('NE');
        expect(state.properties?.humidity).toBe(76);
    });

    it('resolves an empty state when the location is not configured', async () => {
        delete settings.weather;
        await expect(api.getDeviceState!({} as any)).resolves.toEqual({});
    });

    it('discovers the single sensor device only when configured', async () => {
        const discovery = await api.publicDiscover!();
        expect(discovery.devices).toHaveLength(1);
        expect(discovery.devices[0]).toMatchObject({
            name: 'Météo',
            type: 'sensor',
            externalId: 'weather.home',
        });

        delete settings.weather;
        await expect(api.publicDiscover!()).resolves.toEqual({ devices: [] });
    });

    it('never writes a reading back upstream', async () => {
        await expect(
            api.changeDeviceState!({} as any, { level: 30 } as any)
        ).resolves.toBe(false);
    });
});
