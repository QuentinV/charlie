import { settings } from '../../manager/services/settings';
import {
    WEATHER_CACHE_MS,
    WEATHER_STATE_SCHEMA,
    conditionLabel,
    directionLabel,
    getWeather,
    isConfigured,
    resetWeatherCache,
    round,
    setWeatherFetch,
    toDeviceState,
    toReading,
    weatherLocation,
} from '../service';

import payload from './fixtures/open-meteo-current.json';

/** The captured payload, as the service receives it. */
const current = payload.current;

const jsonResponse = (body: unknown, ok = true) =>
    ({ ok, json: async () => body }) as unknown as Response;

describe('weather reading helpers', () => {
    it('maps the WMO codes to French labels and never guesses', () => {
        expect(conditionLabel(0)).toBe('Ciel dégagé');
        expect(conditionLabel(1)).toBe('Principalement dégagé');
        expect(conditionLabel(61)).toBe('Pluie légère');
        expect(conditionLabel(95)).toBe('Orage');
        expect(conditionLabel(1234)).toBe('Condition inconnue');
    });

    it('converts degrees to the 8-point French cardinal', () => {
        expect(directionLabel(0)).toBe('N');
        expect(directionLabel(45)).toBe('NE');
        expect(directionLabel(57)).toBe('NE');
        expect(directionLabel(90)).toBe('E');
        expect(directionLabel(180)).toBe('S');
        expect(directionLabel(225)).toBe('SO');
        expect(directionLabel(315)).toBe('NO');
        expect(directionLabel(350)).toBe('N');
        expect(directionLabel(-90)).toBe('O');
        expect(directionLabel(NaN)).toBe('');
    });

    it('rounds at the source', () => {
        expect(round(9.84, 1)).toBe(9.8);
        expect(round(9.86, 1)).toBe(9.9);
        expect(round(6.4)).toBe(6);
        expect(round(NaN, 1)).toBe(0);
    });

    it('reads the captured Open-Meteo payload', () => {
        expect(toReading(current)).toEqual({
            temperature: 9.8,
            apparentTemperature: 7.8,
            humidity: 76,
            precipitation: 0,
            windSpeed: 6,
            windDirection: 'NE',
            condition: 'Principalement dégagé',
            isDay: false,
            observedAt: '00:00',
        });
    });

    it('rejects a payload without a temperature', () => {
        expect(toReading(null)).toBeNull();
        expect(toReading({})).toBeNull();
        expect(toReading({ temperature_2m: null })).toBeNull();
    });

    it('publishes every advertised property (schema == state)', () => {
        const state = toDeviceState(toReading(current)!);

        // `level` is the canonical number, the rest lives in the properties bag.
        expect(state.level).toBe(9.8);
        expect(state.power).toBe('on');
        expect(state.properties?.unit_of_measurement).toBe('°C');
        expect(state.properties?.device_class).toBe('temperature');
        expect(state.properties?.day_night).toBe('Nuit');

        for (const field of WEATHER_STATE_SCHEMA) {
            if (field.key === 'level') continue;
            expect(state.properties?.[field.key]).not.toBeUndefined();
        }
    });
});

describe('weather service', () => {
    const fetchMock = jest.fn();
    let fetchCalls: number;

    beforeEach(() => {
        fetchCalls = 0;
        fetchMock.mockReset();
        fetchMock.mockImplementation(async () => {
            fetchCalls += 1;
            return jsonResponse(payload);
        });
        setWeatherFetch(fetchMock as unknown as typeof fetch);
        resetWeatherCache();
        settings.weather = { latitude: 48.85, longitude: 2.35 };
    });

    afterEach(() => {
        delete settings.weather;
        resetWeatherCache();
    });

    it('is unconfigured without coordinates', () => {
        delete settings.weather;
        expect(isConfigured()).toBe(false);
        expect(weatherLocation()).toBeNull();
    });

    it('is configured with coordinates', () => {
        expect(isConfigured()).toBe(true);
        expect(weatherLocation()).toEqual({
            latitude: 48.85,
            longitude: 2.35,
        });
    });

    it('resolves null when no location is configured, without calling out', async () => {
        delete settings.weather;
        await expect(getWeather()).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('requests the full metric set for the configured location', async () => {
        await getWeather();

        const url = String(fetchMock.mock.calls[0][0]);
        expect(url).toContain('latitude=48.85');
        expect(url).toContain('longitude=2.35');
        expect(url).toContain('timezone=auto');
        for (const field of [
            'temperature_2m',
            'apparent_temperature',
            'relative_humidity_2m',
            'precipitation',
            'weather_code',
            'wind_speed_10m',
            'wind_direction_10m',
            'is_day',
        ]) {
            expect(url).toContain(field);
        }
    });

    it('caches a reading for WEATHER_CACHE_MS', async () => {
        const first = await getWeather();
        const second = await getWeather();

        expect(first).not.toBeNull();
        expect(second).toEqual(first);
        expect(fetchCalls).toBe(1);
        expect(WEATHER_CACHE_MS).toBeGreaterThan(0);
    });

    it('shares one in-flight request between concurrent callers', async () => {
        const [a, b, c] = await Promise.all([
            getWeather(),
            getWeather(),
            getWeather(),
        ]);

        expect(a).toEqual(b);
        expect(b).toEqual(c);
        expect(fetchCalls).toBe(1);
    });

    it('refreshes on demand with force', async () => {
        await getWeather();
        await getWeather({ force: true });
        expect(fetchCalls).toBe(2);
    });

    it('refetches when the configured location changes', async () => {
        await getWeather();
        settings.weather = { latitude: 43.6, longitude: 1.44 };
        await getWeather();

        expect(fetchCalls).toBe(2);
        expect(String(fetchMock.mock.calls[1][0])).toContain('latitude=43.6');
    });

    it('resolves null on upstream errors instead of throwing', async () => {
        fetchMock.mockImplementation(async () => {
            throw new Error('network down');
        });
        await expect(getWeather()).resolves.toBeNull();

        fetchMock.mockImplementation(async () => jsonResponse({}, false));
        await expect(getWeather()).resolves.toBeNull();
    });

    it('resolves null on a malformed payload', async () => {
        fetchMock.mockImplementation(async () => jsonResponse({ current: {} }));
        await expect(getWeather()).resolves.toBeNull();
    });
});
