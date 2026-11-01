import { settings } from '../manager/services/settings';
import { DeviceState, StatePropertySchema } from '../types';

/**
 * Weather service — the single source of truth for current conditions.
 *
 * Every consumer (the `weather` device provider, the `askWeather` NLU action
 * and the LLM `fetch-weather` tool) reads the SAME reading, so the card, the
 * echo screen and the spoken answer can never disagree.
 *
 * Open-Meteo needs no API key and returns the whole metric set in one request;
 * the reading is cached (one upstream call per `WEATHER_CACHE_MS` however many
 * screens refresh) and never invented: an unconfigured location or a failed
 * fetch resolves to `null`, exactly like an `unavailable` HA entity.
 */

export const WEATHER_CACHE_MS = 10 * 60 * 1000;

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

/** Open-Meteo field names of the catalogue below, in one request. */
const CURRENT_FIELDS = [
    'temperature_2m',
    'apparent_temperature',
    'relative_humidity_2m',
    'precipitation',
    'weather_code',
    'wind_speed_10m',
    'wind_direction_10m',
    'is_day',
].join(',');

export interface WeatherReading {
    /** Canonical number of the device (`state.level`). */
    temperature: number;
    apparentTemperature: number;
    humidity: number;
    precipitation: number;
    windSpeed: number;
    /** French 8-point cardinal (`SO`, `NE`…). */
    windDirection: string;
    /** French label of the WMO code. */
    condition: string;
    isDay: boolean;
    /** Local observation time, `HH:MM`. */
    observedAt: string;
}

/** WMO 4677 weather codes, as published by Open-Meteo. */
export const WMO_CONDITIONS: Record<number, string> = {
    0: 'Ciel dégagé',
    1: 'Principalement dégagé',
    2: 'Partiellement nuageux',
    3: 'Couvert',
    45: 'Brouillard',
    48: 'Brouillard givrant',
    51: 'Bruine légère',
    53: 'Bruine',
    55: 'Bruine dense',
    56: 'Bruine verglaçante',
    57: 'Bruine verglaçante dense',
    61: 'Pluie légère',
    63: 'Pluie',
    65: 'Forte pluie',
    66: 'Pluie verglaçante',
    67: 'Forte pluie verglaçante',
    71: 'Neige légère',
    73: 'Neige',
    75: 'Forte neige',
    77: 'Grains de neige',
    80: 'Averses légères',
    81: 'Averses',
    82: 'Averses violentes',
    85: 'Averses de neige',
    86: 'Fortes averses de neige',
    95: 'Orage',
    96: 'Orage avec grêle',
    99: 'Orage violent avec grêle',
};

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

/**
 * Property schema of the weather device.
 *
 * `key` refers to `DeviceState.properties[key]` (except `level`, the canonical
 * number), so this table is what the device panel renders, what the history
 * chart offers as metrics, and what the provider publishes — one list, no
 * duplicated vocabulary. Everything here is telemetry: `readonly`, never sent
 * back to Open-Meteo.
 */
export const WEATHER_STATE_SCHEMA: StatePropertySchema[] = [
    {
        key: 'level',
        label: 'Température',
        type: 'number',
        unit: '°C',
        readonly: true,
    },
    {
        key: 'temperature',
        label: 'Température extérieure',
        type: 'number',
        unit: '°C',
        readonly: true,
    },
    {
        key: 'apparent_temperature',
        label: 'Ressenti',
        type: 'number',
        unit: '°C',
        readonly: true,
    },
    {
        key: 'humidity',
        label: 'Humidité',
        type: 'number',
        unit: '%',
        readonly: true,
    },
    {
        key: 'precipitation',
        label: 'Précipitations',
        type: 'number',
        unit: 'mm',
        readonly: true,
    },
    {
        key: 'wind_speed',
        label: 'Vent',
        type: 'number',
        unit: 'km/h',
        readonly: true,
    },
    {
        key: 'wind_direction',
        label: 'Direction du vent',
        type: 'string',
        readonly: true,
    },
    {
        key: 'condition',
        label: 'Condition',
        type: 'string',
        readonly: true,
    },
    {
        key: 'day_night',
        label: 'Jour / nuit',
        type: 'string',
        readonly: true,
    },
    {
        key: 'observed_at',
        label: 'Relevé',
        type: 'string',
        readonly: true,
    },
];

/** Round at the source so the OLED and the cards never print `9.8000000001`. */
export const round = (value: number, precision = 0): number => {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
};

/** WMO code → French label; unknown codes stay honest instead of guessing. */
export function conditionLabel(code: number): string {
    return WMO_CONDITIONS[Number(code)] ?? 'Condition inconnue';
}

/** Degrees → 8-point French cardinal (the gateway publishes degrees). */
export function directionLabel(degrees: number): string {
    if (!Number.isFinite(degrees)) return '';
    const normalized = ((degrees % 360) + 360) % 360;
    return CARDINALS[Math.round(normalized / 45) % 8];
}

/**
 * Read both spellings of a settings key: `$set` on `settings.<dotted.key>`
 * stores nested objects, while older entries were written flat.
 */
function setting(key: string): any {
    const nested = key
        .split('.')
        .reduce((acc: any, part) => (acc == null ? acc : acc[part]), settings);
    return nested !== undefined ? nested : settings[key];
}

/** Home coordinates, or `null` when the feature is not configured. */
export function weatherLocation(): {
    latitude: number;
    longitude: number;
} | null {
    const latitude = Number(setting('weather.latitude'));
    const longitude = Number(setting('weather.longitude'));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
}

export function isConfigured(): boolean {
    return weatherLocation() !== null;
}

/** Open-Meteo `current` payload → reading, or `null` when it carries no temperature. */
export function toReading(current: any): WeatherReading | null {
    if (!current || typeof current !== 'object') return null;

    // `Number(null)` is 0: an absent/null temperature is unavailable, never 0°C.
    const raw = current.temperature_2m;
    if (raw === null || raw === undefined || raw === '') return null;

    const temperature = Number(raw);
    if (!Number.isFinite(temperature)) return null;

    const apparent = Number(current.apparent_temperature);
    const observed = String(current.time ?? '').match(/(\d{2}:\d{2})$/);

    return {
        temperature: round(temperature, 1),
        apparentTemperature: round(
            Number.isFinite(apparent) ? apparent : temperature,
            1
        ),
        humidity: round(Number(current.relative_humidity_2m)),
        precipitation: round(Number(current.precipitation), 1),
        windSpeed: round(Number(current.wind_speed_10m)),
        windDirection: directionLabel(Number(current.wind_direction_10m)),
        condition: conditionLabel(Number(current.weather_code)),
        isDay: Number(current.is_day) !== 0,
        observedAt: observed?.[1] ?? '',
    };
}

/**
 * Reading → device state.
 *
 * `level` is the canonical number of every device and here it is the
 * temperature — which is also what the sensor wording of `askWeather` and the
 * `Météo` card read. `unit_of_measurement` therefore belongs to `level`, while
 * each named metric carries its own unit in the property schema.
 */
export function toDeviceState(reading: WeatherReading): DeviceState {
    return {
        power: 'on',
        level: reading.temperature,
        properties: {
            temperature: reading.temperature,
            apparent_temperature: reading.apparentTemperature,
            humidity: reading.humidity,
            precipitation: reading.precipitation,
            wind_speed: reading.windSpeed,
            wind_direction: reading.windDirection,
            condition: reading.condition,
            day_night: reading.isDay ? 'Jour' : 'Nuit',
            observed_at: reading.observedAt,
            unit_of_measurement: '°C',
            device_class: 'temperature',
        },
    };
}

// ===== Fetching =====

type WeatherFetch = typeof fetch;

let fetchImpl: WeatherFetch = (input, init) => fetch(input, init);
let cache: {
    location: string;
    reading: WeatherReading;
    at: number;
} | null = null;
let pending: Promise<WeatherReading | null> | null = null;

/** Test seam: the service never talks to the network in unit tests. */
export function setWeatherFetch(impl: WeatherFetch): void {
    fetchImpl = impl;
}

/** Drop the cache (settings changed, tests). */
export function resetWeatherCache(): void {
    cache = null;
    pending = null;
}

/**
 * One request to Open-Meteo for any coordinates (no cache, no settings).
 *
 * Exposed for callers that must honour their own coordinates (the LLM
 * `fetch-weather` tool); everything home-related goes through `getWeather`.
 */
export async function fetchCurrent(
    latitude: number,
    longitude: number
): Promise<WeatherReading | null> {
    try {
        const url =
            `${OPEN_METEO_URL}?latitude=${latitude}&longitude=${longitude}` +
            `&current=${CURRENT_FIELDS}&timezone=auto`;
        const response = await fetchImpl(url);
        if (!response?.ok) return null;
        const data = await response.json();
        return toReading(data?.current);
    } catch (e) {
        // A weather outage must never take a consumer down with it.
        return null;
    }
}

/**
 * Current conditions at the configured home location.
 *
 * One upstream request per `WEATHER_CACHE_MS`; concurrent callers share the
 * in-flight promise. `force` bypasses the cache (never the single flight).
 */
export async function getWeather(
    options: { force?: boolean } = {}
): Promise<WeatherReading | null> {
    const location = weatherLocation();
    if (!location) return null;

    const key = `${location.latitude},${location.longitude}`;
    if (
        !options.force &&
        cache &&
        cache.location === key &&
        Date.now() - cache.at < WEATHER_CACHE_MS
    ) {
        return cache.reading;
    }

    if (pending) return pending;

    pending = (async () => {
        try {
            const reading = await fetchCurrent(
                location.latitude,
                location.longitude
            );
            if (reading) cache = { location: key, reading, at: Date.now() };
            return reading;
        } finally {
            pending = null;
        }
    })();

    return pending;
}
