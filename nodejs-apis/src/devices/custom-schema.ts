import { DeviceState, StatePropertySchema } from '../types';

/**
 * Bookkeeping keys of a custom device's `properties` bag: provider metadata a
 * flow may publish alongside its measurements, never a chartable metric. Same
 * list the frontend's sensor panel skips.
 */
const NON_MEASUREMENT = new Set([
    'state',
    'last_changed',
    'last_updated',
    'device_class',
    'unit_of_measurement',
    'state_class',
    'icon',
    'restored',
    'supported_features',
    'options',
    'friendly_name',
]);

/** `outside_temperature` → `Outside temperature`. */
const humanise = (key: string): string =>
    key
        .replace(/_/g, ' ')
        .replace(/^./, (character) => character.toUpperCase());

/**
 * Numeric metric keys a custom device's state advertises, in publish order and
 * without duplicates. A flow may send `level` both as the canonical field and
 * inside `properties`, so the canonical one wins.
 */
export const metricKeys = (state?: DeviceState): string[] => {
    const keys: string[] = [];
    const seen = new Set<string>();

    const push = (key: string): void => {
        if (seen.has(key)) return;
        seen.add(key);
        keys.push(key);
    };

    if (typeof state?.level === 'number' && Number.isFinite(state.level)) {
        push('level');
    }

    for (const [key, value] of Object.entries(state?.properties ?? {})) {
        if (NON_MEASUREMENT.has(key)) continue;
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        push(key);
    }

    return keys;
};

/**
 * Property schema of a custom device, derived from what the flow actually
 * publishes: every finite-number entry of `state.properties` becomes a
 * chartable metric, plus `level` (the canonical number) when the flow sends
 * one.
 *
 * A Node-RED flow declares no schema at build time, so the MQTT payload is the
 * only vocabulary available — and exactly the evidence the history chart needs
 * (`DeviceStateChart` offers a metric picker per numeric `capabilities.state`
 * field). Everything is `readonly`: the flow owns the state, Charlie only reads
 * it. A device with no numeric state yet advertises nothing, rather than
 * guessing.
 *
 * Keys are de-duplicated upstream (`metricKeys`): a flow may publish `level`
 * both as the canonical field and inside `properties`, and the chart renders one
 * `<MenuItem>` per schema entry (`DeviceStateChart` keys on `field.key`), so a
 * repeat would be a duplicate React key.
 *
 * Lives outside the provider so the MQTT state subscriber can reason about the
 * schema without importing a provider (which imports the broker).
 */
export const deriveStateSchema = (state?: DeviceState): StatePropertySchema[] =>
    metricKeys(state).map((key) => ({
        key,
        label: key === 'level' ? 'Niveau' : humanise(key),
        type: 'number',
        readonly: true,
    }));

/**
 * Stable fingerprint of the metric vocabulary `deriveStateSchema` advertises.
 * Two states with the same signature produce the same schema, so a cached
 * capabilities entry stays valid even though the readings themselves changed.
 */
export const schemaSignature = (state?: DeviceState): string =>
    metricKeys(state).sort().join('|');

/**
 * Whether the schema a cache entry advertises differs from the one `state`
 * would produce. A missing cached schema means nothing to compare against (the
 * entry is either absent or static), so no change is reported.
 */
export const stateSchemaChanged = (
    cached: StatePropertySchema[] | undefined,
    state?: DeviceState
): boolean => {
    if (!cached) return false;
    const cachedSignature = cached
        .map((field) => field.key)
        .sort()
        .join('|');
    return cachedSignature !== schemaSignature(state);
};
