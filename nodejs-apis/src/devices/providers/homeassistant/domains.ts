/**
 * Home Assistant **domain** tables — the standard features of each HA device
 * type, written in HA's own vocabulary.
 *
 * This is DATA: one row per property HA documents for a domain (`temperature`,
 * `hvac_mode`, `fan_mode`…), the service that writes it, and — for enums — the
 * attribute carrying the allowed values (`hvac_modes`, `fan_modes`…). A device
 * is supported because its domain is HA's, not because a brand has an entry:
 * adding a device means adding it to Home Assistant.
 */
import { StatePropertySchema } from '../../../types';

/** How a canonical property maps back onto a gateway service field. */
export interface PropertyWrite {
    service: string;
    field: string;
    cast?: 'number' | 'string' | 'boolean';
}

/** A canonical property exposed by a device domain. */
export interface PropertyProfile {
    /**
     * Canonical key: the gateway attribute / service-field name (HA vocabulary
     * for HA, the provider's own names elsewhere), advertised to the frontend
     * and stored in `properties`.
     */
    key: string;
    label: string;
    type: StatePropertySchema['type'];
    /** Restrict the property to some domains of the table (default: all). */
    domains?: string[];
    /** Gateway attributes carrying [min, max, step]. */
    range?: [string, string, string?];
    defaults?: { min?: number; max?: number; step?: number };
    /** Gateway attributes carrying the allowed values. */
    options?: string[];
    /** Gateway values dropped from the selector (e.g. `off` = the power state). */
    optionExclude?: string[];
    /** Canonical value → display label. */
    labels?: Record<string, string>;
    unit?: string;
    readonly?: boolean;
    /** Emit even when the gateway reports nothing (stable readouts). */
    always?: boolean;
    write?: PropertyWrite;
}


/**
 * Gateway `supported_features` enum names → bits. Published per domain by HA
 * (`services.yaml` + entity docs); used to hide services a device can't do.
 * Unknown names are treated as "no gate" (fail-open), never as "unsupported".
 */
export const SUPPORTED_FEATURES: Record<string, number> = {
    // climate.ClimateEntityFeature
    'climate.ClimateEntityFeature.TARGET_TEMPERATURE': 1,
    'climate.ClimateEntityFeature.TARGET_TEMPERATURE_RANGE': 2,
    'climate.ClimateEntityFeature.TARGET_HUMIDITY': 4,
    'climate.ClimateEntityFeature.FAN_MODE': 8,
    'climate.ClimateEntityFeature.PRESET_MODE': 16,
    'climate.ClimateEntityFeature.SWING_MODE': 32,
    'climate.ClimateEntityFeature.AUX_HEAT': 64,
    'climate.ClimateEntityFeature.TURN_ON': 128,
    'climate.ClimateEntityFeature.TURN_OFF': 256,
    'climate.ClimateEntityFeature.SWING_HORIZONTAL_MODE': 512,
    // water_heater.WaterHeaterEntityFeature
    'water_heater.WaterHeaterEntityFeature.TARGET_TEMPERATURE': 1,
    'water_heater.WaterHeaterEntityFeature.OPERATION_MODE': 2,
    'water_heater.WaterHeaterEntityFeature.AWAY_MODE': 4,
    'water_heater.WaterHeaterEntityFeature.ON_OFF': 8,
    // cover.CoverEntityFeature
    'cover.CoverEntityFeature.OPEN': 1,
    'cover.CoverEntityFeature.CLOSE': 2,
    'cover.CoverEntityFeature.SET_POSITION': 4,
    'cover.CoverEntityFeature.STOP': 8,
    'cover.CoverEntityFeature.OPEN_TILT': 16,
    'cover.CoverEntityFeature.CLOSE_TILT': 32,
    'cover.CoverEntityFeature.STOP_TILT': 64,
    'cover.CoverEntityFeature.SET_TILT_POSITION': 128,
    'cover.CoverEntityFeature.TOGGLE': 256,
    // media_player.MediaPlayerEntityFeature
    'media_player.MediaPlayerEntityFeature.PAUSE': 1,
    'media_player.MediaPlayerEntityFeature.SEEK': 2,
    'media_player.MediaPlayerEntityFeature.VOLUME_SET': 4,
    'media_player.MediaPlayerEntityFeature.VOLUME_MUTE': 8,
    'media_player.MediaPlayerEntityFeature.PREVIOUS_TRACK': 16,
    'media_player.MediaPlayerEntityFeature.NEXT_TRACK': 32,
    'media_player.MediaPlayerEntityFeature.TURN_ON': 128,
    'media_player.MediaPlayerEntityFeature.TURN_OFF': 256,
    'media_player.MediaPlayerEntityFeature.PLAY_MEDIA': 512,
    'media_player.MediaPlayerEntityFeature.VOLUME_STEP': 1024,
    'media_player.MediaPlayerEntityFeature.SELECT_SOURCE': 2048,
    'media_player.MediaPlayerEntityFeature.STOP': 4096,
    'media_player.MediaPlayerEntityFeature.PLAY': 16384,
    // fan.FanEntityFeature
    'fan.FanEntityFeature.SET_SPEED': 1,
    'fan.FanEntityFeature.OSCILLATE': 2,
    'fan.FanEntityFeature.DIRECTION': 4,
    'fan.FanEntityFeature.PRESET_MODE': 8,
    // vacuum.VacuumEntityFeature
    'vacuum.VacuumEntityFeature.TURN_ON': 1,
    'vacuum.VacuumEntityFeature.TURN_OFF': 2,
    'vacuum.VacuumEntityFeature.PAUSE': 4,
    'vacuum.VacuumEntityFeature.STOP': 8,
    'vacuum.VacuumEntityFeature.RETURN_HOME': 16,
    // lock.LockEntityFeature
    'lock.LockEntityFeature.OPEN': 1,
    // remote.RemoteEntityFeature — without these bits the catalogue's
    // learn_command / delete_command look available on every remote entity.
    'remote.RemoteEntityFeature.LEARN_COMMAND': 1,
    'remote.RemoteEntityFeature.DELETE_COMMAND': 2,
    'remote.RemoteEntityFeature.ACTIVITY': 4,
};

/** Domains whose services are exposed as callable functions (opt-in). */
export const FUNCTION_DOMAINS = new Set([
    'climate',
    'water_heater',
    'media_player',
    'cover',
    'fan',
    'humidifier',
    'vacuum',
    'lock',
    // Sibling-only domain: HA's `remote` owns the power services and the keypad
    // of a device exposed as a `media_player` (or a `climate`). It merges in
    // because it is a sibling in a function domain — for every integration.
    'remote',
]);

/** Services that would confuse the agent (duplicates of turn_on/off). */
export const FUNCTION_BLOCKLIST = new Set([
    'climate.toggle',
    'cover.toggle',
    'remote.toggle',
]);

/**
 * Function parameters whose values come from an entity attribute rather than
 * from the service selector (`media_player.select_source` offers the names in
 * `source_list`). `domain -> service -> field -> attribute name`.
 *
 * This is the ONE way a free field gets options without the catalogue saying
 * so. What HA does not publish — the key names of `remote.send_command`, which
 * every integration spells its own way — stays a free field, exactly as in HA's
 * own UI. Charlie never ships a vocabulary it cannot read from the gateway.
 */
export const PARAM_OPTION_SOURCES: Record<
    string,
    Record<string, Record<string, string>>
> = {
    media_player: {
        select_source: { source: 'source_list' },
    },
};

/**
 * Domain → sibling domains able to power the device when its own domain cannot
 * (`media_player` without `TURN_ON` → its `remote` sibling).
 */
export const POWER_FALLBACK_DOMAINS: Record<string, string[]> = {
    media_player: ['remote'],
};

/**
 * Feature gate that must be set for a domain's entity to power itself. Only the
 * domains HA actually gates appear here — lights, switches and covers always
 * support turn_on/turn_off (their catalogues may still gate other services).
 */
export const POWER_FEATURES: Record<string, string> = {
    media_player: 'media_player.MediaPlayerEntityFeature.TURN_ON',
    vacuum: 'vacuum.VacuumEntityFeature.TURN_ON',
};

/**
 * Sibling domains worth fetching for a device: the ones that may contribute
 * functions or power. Empty -> the device needs no sibling lookup at all (the
 * common case, so the registry/state round-trips are skipped).
 *
 * The rule names HA domains only. HA models one physical device as several
 * entities, so any sibling in a function domain may contribute services; which
 * integration exposes those entities is HA's business, never this provider's.
 */
export const siblingDomainsFor = (domain: string): string[] => {
    if (!FUNCTION_DOMAINS.has(domain) && !POWER_FALLBACK_DOMAINS[domain]) {
        return [];
    }

    return [
        ...new Set([
            ...Array.from(FUNCTION_DOMAINS).filter((d) => d !== domain),
            ...(POWER_FALLBACK_DOMAINS[domain] ?? []),
        ]),
    ];
};



/**
 * Domains whose `DeviceState.level` is a **writable slider** (brightness,
 * position, volume). Not a property: the level lives outside the properties
 * bag.
 *
 * This table is about advertising a control. How `level` is *derived* for every
 * domain — including the ones with no slider at all, like a thermostat's
 * ambient temperature — is `LEVEL_SOURCES` below: a domain may publish a level
 * without offering a level control, and vice versa.
 *
 * `attributes` / `features` / `modes` are the evidence the gateway must give
 * before the level is advertised: an on/off-only bulb has no slider, and a
 * media player without `VOLUME_SET` keeps the step service instead of an
 * absolute volume. Missing metadata fails open, like every other gate.
 */
export interface LevelField extends StatePropertySchema {
    /** Attributes that carry the level (any of). */
    attributes?: string[];
    /** HA `supported_features` bits that prove the level is writable (any of). */
    features?: string[];
    /** Attribute whose value list must contain something outside `exclude`. */
    modes?: { attribute: string; exclude: string[] };
}

export const LEVEL_FIELDS: Record<string, LevelField> = {
    light: {
        key: 'level',
        label: 'Luminosité',
        type: 'range',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
        attributes: ['brightness', 'brightness_pct'],
        modes: { attribute: 'supported_color_modes', exclude: ['onoff'] },
    },
    cover: {
        key: 'level',
        label: 'Position',
        type: 'range',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
        attributes: ['current_position', 'position'],
        features: ['cover.CoverEntityFeature.SET_POSITION'],
    },
    media_player: {
        key: 'level',
        label: 'Volume',
        type: 'range',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
        attributes: ['volume_level'],
        features: ['media_player.MediaPlayerEntityFeature.VOLUME_SET'],
    },
};

/** One attribute `DeviceState.level` can be read from. */
export interface LevelSource {
    /** Gateway attribute carrying the value. */
    attribute: string;
    /** Multiplier converting the gateway unit to a percentage (volume: 0..1). */
    scale?: number;
}

/**
 * How `DeviceState.level` is derived, per gateway domain: the device's standard
 * main number, as a priority list of attributes (the first one the gateway
 * reports wins).
 *
 * `level` is Charlie's canonical numeric value — the card readout, the history
 * chart, a state answer, what the agent sees. Every domain that HAS one
 * publishes it, which is why the list is wider than `LEVEL_FIELDS`: a thermostat
 * has no level control but its ambient temperature is still the number to show.
 *
 * A measured attribute comes before a setpoint (`current_temperature` before
 * `temperature`, `current_humidity` before `humidity`): `level` is what the
 * device reports now, and writing it drives the device's own control (light
 * brightness, cover position, media volume, fan percentage, humidifier
 * humidity). Domains whose value is boolean (`switch`, `input_boolean`,
 * `binary_sensor`, `automation`) or absent (`button`, `script`, `scene`,
 * `camera`) have no row: their state is `power`.
 */
export const LEVEL_SOURCES: Record<string, LevelSource[]> = {
    light: [
        { attribute: 'brightness_pct' },
        { attribute: 'brightness', scale: 100 / 255 },
    ],
    cover: [{ attribute: 'current_position' }, { attribute: 'position' }],
    fan: [{ attribute: 'percentage' }],
    humidifier: [{ attribute: 'current_humidity' }, { attribute: 'humidity' }],
    media_player: [{ attribute: 'volume_level', scale: 100 }],
    climate: [
        { attribute: 'current_temperature' },
        { attribute: 'temperature' },
    ],
    water_heater: [
        { attribute: 'current_temperature' },
        { attribute: 'temperature' },
    ],
    vacuum: [{ attribute: 'battery_level' }],
    lock: [{ attribute: 'battery_level' }],
};

/**
 * Domains whose level IS the entity state: a measurement keeps its value there,
 * never in an attribute.
 */
export const LEVEL_STATE_DOMAINS = new Set(['sensor']);

// ===== Climate =====

/**
 * Display labels for the HA HVAC modes (the canonical values are HA's own:
 * `off`, `heat`, `cool`, `dry`, `fan_only`, `heat_cool`, `auto`).
 */
const MODE_LABELS: Record<string, string> = {
    heat: 'Chaud',
    cool: 'Froid',
    dry: 'Déshumi.',
    fan_only: 'Ventil.',
    heat_cool: 'Auto',
    auto: 'Auto',
};

/**
 * Gateway swing values → display label. HA documents `on` / `off` / `auto` and
 * leaves the rest to the entity, so the documented values get a label and
 * anything else falls back to the raw gateway value.
 */
const SWING_LABELS: Record<string, string> = {
    on: 'Actif',
    off: 'Arrêté',
    auto: 'Auto',
    swing: 'Oscillant',
};

export const HVAC_ACTION_LABELS: Record<string, string> = {
    off: 'Off',
    idle: 'Inactif',
    heating: 'Chauffe',
    cooling: 'Refroidit',
    drying: 'Déshumidifie',
    fan: 'Ventile',
};

/**
 * Climate / water_heater standard properties. Keys and enum values are HA's own
 * (`temperature`, `hvac_mode` / `operation_mode`, `fan_mode`, `fan_only`,
 * `heat_cool`…); where the two domains spell the same semantic differently the
 * row is declared once, scoped by `domains`.
 */
export const STANDARD_PROPERTIES: PropertyProfile[] = [
    {
        key: 'temperature',
        label: 'Consigne',
        type: 'range',
        unit: '°C',
        range: ['min_temp', 'max_temp', 'target_temp_step'],
        defaults: { min: 16, max: 30, step: 0.5 },
        // Primary control: keep it available with defaults even when the
        // gateway is momentarily silent.
        always: true,
        write: { service: 'set_temperature', field: 'temperature', cast: 'number' },
    },
    {
        key: 'target_temp_high',
        label: 'Consigne haute',
        type: 'number',
        unit: '°C',
        write: { service: 'set_temperature', field: 'target_temp_high', cast: 'number' },
    },
    {
        key: 'target_temp_low',
        label: 'Consigne basse',
        type: 'number',
        unit: '°C',
        write: { service: 'set_temperature', field: 'target_temp_low', cast: 'number' },
    },
    {
        // climate spells the mode `hvac_mode`…
        key: 'hvac_mode',
        label: 'Mode',
        type: 'enum',
        domains: ['climate'],
        options: ['hvac_modes'],
        // 'off' is the power state, not a selectable mode chip.
        optionExclude: ['off'],
        labels: MODE_LABELS,
        always: true,
        write: { service: 'set_hvac_mode', field: 'hvac_mode', cast: 'string' },
    },
    {
        // …water_heater spells it `operation_mode`.
        key: 'operation_mode',
        label: 'Mode',
        type: 'enum',
        domains: ['water_heater'],
        options: ['operation_list'],
        // 'off' is the power state, not a selectable mode chip.
        optionExclude: ['off'],
        always: true,
        write: {
            service: 'set_operation_mode',
            field: 'operation_mode',
            cast: 'string',
        },
    },
    {
        key: 'fan_mode',
        label: 'Ventilation',
        type: 'enum',
        domains: ['climate'],
        options: ['fan_modes'],
        labels: { auto: 'Auto' },
        write: { service: 'set_fan_mode', field: 'fan_mode', cast: 'string' },
    },
    {
        key: 'swing_mode',
        label: 'Orientation',
        type: 'enum',
        domains: ['climate'],
        options: ['swing_modes'],
        labels: SWING_LABELS,
        write: { service: 'set_swing_mode', field: 'swing_mode', cast: 'string' },
    },
    {
        key: 'swing_horizontal_mode',
        label: 'Orientation horiz.',
        type: 'enum',
        domains: ['climate'],
        options: ['swing_horizontal_modes'],
        labels: SWING_LABELS,
        write: {
            service: 'set_swing_horizontal_mode',
            field: 'swing_horizontal_mode',
            cast: 'string',
        },
    },
    {
        key: 'current_temperature',
        label: 'Température ambiante',
        type: 'number',
        unit: '°C',
        readonly: true,
        always: true,
    },
    {
        key: 'hvac_action',
        label: 'Activité',
        type: 'enum',
        labels: HVAC_ACTION_LABELS,
        // Not `always`: the tile only appears for gateways that report an
        // action (not every entity does, and a missing one would be a
        // permanent '-').
        readonly: true,
    },
];

/**
 * Properties of one HA domain, in display order. Only domains with rows in this
 * table get any — a `light` or a `sensor` must not inherit climate properties.
 */
export const propertiesFor = (domain: string): PropertyProfile[] =>
    MODE_DOMAINS.has(domain)
        ? STANDARD_PROPERTIES.filter(
              (property) =>
                  !property.domains || property.domains.includes(domain)
          )
        : [];

/** Domains whose entity `state` is the mode property, not on/off. */
export const MODE_DOMAINS = new Set(['climate', 'water_heater']);

/** Control profile advertised to the frontend for a domain, if any. */
export const CONTROL_BY_DOMAIN: Record<string, string> = {
    climate: 'clim',
};

