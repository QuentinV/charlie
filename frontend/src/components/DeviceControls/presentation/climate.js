/**
 * Presentation dictionary for climate devices — the ONLY place that knows how a
 * climate property should look (icon, colour, label, unit) and where the
 * "no schema" fallbacks live.
 *
 * Both the premium `clim` panel and the default thermostat panel read from
 * here, so supporting a new provider/integration is a data change rather than
 * a new panel: keys are the canonical property names advertised through
 * `capabilities.state`, and unknown enum values fall back to a humanised label.
 */
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import AirIcon from '@mui/icons-material/Air';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DeviceThermostatIcon from '@mui/icons-material/DeviceThermostat';
import SensorsIcon from '@mui/icons-material/Sensors';
import { GOLD, GOLD_DARK, AMBER } from '../primitives/tokens';

/** Used when a provider advertises no schema at all (native providers). */
export const DEFAULT_TEMP_RANGE = { min: 16, max: 30, step: 0.5 };

/** Known operation modes: icon + accent colour (unlisted modes get defaults). */
export const MODES = [
    {
        value: 'heat',
        label: 'Chaud',
        icon: WbSunnyIcon,
        color: AMBER,
    },
    {
        value: 'cool',
        label: 'Froid',
        icon: AcUnitIcon,
        color: '#4EC8F5',
    },
    {
        value: 'dry',
        label: 'Déshumi.',
        icon: WaterDropIcon,
        color: '#4CD964',
    },
    {
        value: 'fan_only',
        label: 'Ventil.',
        icon: AirIcon,
        color: '#58C7B8',
    },
    {
        value: 'heat_cool',
        label: 'Auto',
        icon: AutoAwesomeIcon,
        color: GOLD,
    },
    {
        // water heaters and some integrations use a plain `auto`
        value: 'auto',
        label: 'Auto',
        icon: AutoAwesomeIcon,
        color: GOLD,
    },
];

/**
 * Known telemetry tiles, in display order. Keys are the gateway's own
 * attribute names (HA: `current_temperature`, `hvac_action`); `text: true`
 * renders a string value. Every other readonly field the schema advertises is
 * appended generically by `climatePresentation`, so a gateway that reports an
 * extra measurement gets a tile without a code change.
 */
export const TELEMETRY = [
    {
        key: 'current_temperature',
        label: 'Ambiante',
        unit: '°C',
        icon: DeviceThermostatIcon,
        color: GOLD,
    },
    {
        key: 'hvac_action',
        label: 'Activité',
        icon: AutoAwesomeIcon,
        color: GOLD_DARK,
        // String value (heating / cooling / idle…) — not a number.
        text: true,
    },
];

/**
 * Attributes that are never telemetry (settings, capabilities, metadata).
 * These are HA's own attribute names — nothing provider-specific belongs here.
 */
const NON_TELEMETRY =
    /^(temperature|target_temp|target_temp_low|target_temp_high|min_temp|max_temp|target_temp_step|hvac_mode|operation_mode|fan_mode|swing_mode|swing_horizontal_mode|preset_mode|supported_features|friendly_name|device_class|unit_of_measurement|state|last_changed|last_updated)$/;

/** Icon / colour / label for a telemetry key (known tiles first, then generic). */
export const telemetryMeta = (key) =>
    TELEMETRY.find((tile) => tile.key === key) ?? {
        key,
        label: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
        icon: SensorsIcon,
        color: GOLD_DARK,
    };

/** HA `hvac_action` values → display label. */
export const HVAC_ACTIONS = {
    off: 'Off',
    idle: 'Inactif',
    heating: 'Chauffe',
    cooling: 'Refroidit',
    drying: 'Déshumidifie',
    fan: 'Ventile',
};

const MODES_BY_VALUE = MODES.reduce((acc, mode) => {
    acc[mode.value] = mode;
    return acc;
}, {});

const DEFAULT_MODE = MODES.find((mode) => mode.value === 'auto') ?? MODES[0];

/** Icon / colour / label for a mode value coming from any provider. */
export const modeMeta = (value) =>
    MODES_BY_VALUE[value] ?? {
        ...DEFAULT_MODE,
        value,
        label: value
            ? value.charAt(0).toUpperCase() + value.slice(1)
            : DEFAULT_MODE.label,
    };

const roundNice = (value) =>
    Number.isFinite(value) ? Number(value.toFixed(2)) : value;

/** `22.00000001` → `22 °C`; undefined/null → `-`. */
export const format = (value, unit = '') =>
    value !== undefined && value !== null
        ? `${roundNice(Number(value))} ${unit}`.trim()
        : '-';

/**
 * Everything the climate panels need to render, derived from the device
 * capabilities + state. Panels stay dumb: they lay out what this returns.
 *
 * @param {object} args
 * @param {Array<any>} [args.schema] `capabilities.state`
 * @param {Record<string, any>} [args.props] `state.properties`
 */
export const climatePresentation = ({ schema = [], props = {} } = {}) => {
    // Canonical keys are the gateway's own (HA: `temperature`, `hvac_mode` /
    // `operation_mode`, `fan_mode`…), so the fields are DISCOVERED from the
    // schema instead of hardcoded — a vocabulary change never touches the panel.
    const writable = (pattern, types) =>
        schema.find(
            (field) =>
                !field.readonly &&
                types.includes(field.type) &&
                pattern.test(field.key)
        );

    const tempField = writable(/temperature/, ['range', 'number']);
    const modeField = writable(/^(hvac|operation)_mode$/, ['enum']);
    const fanField = writable(/fan/, ['enum']);
    // Orientation (swing) is optional: only devices whose capabilities
    // advertise it get the rows.
    const swingField = writable(/^swing_mode$/, ['enum']);
    const swingHorizontalField = writable(/^swing_horizontal_mode$/, ['enum']);

    const valueOf = (field, fallback) =>
        field && props[field.key] !== undefined ? props[field.key] : fallback;

    const modeRaw = valueOf(modeField, 'heat_cool');
    const modeOption = modeField?.options?.find((o) => o.value === modeRaw);

    // Telemetry, in two passes: the known tiles first, then every other
    // readonly field the capabilities advertise and the device reports — so a
    // new measurement shows up through data, never through a new key here.
    const telemetryKeys = TELEMETRY.filter(
        (tile) =>
            tile.key in props || schema.some((field) => field.key === tile.key)
    ).map((tile) => tile.key);
    schema.forEach((field) => {
        if (!field.readonly || !(field.key in props)) return;
        if (NON_TELEMETRY.test(field.key)) return;
        if (!['number', 'string', 'enum'].includes(field.type)) return;
        if (!telemetryKeys.includes(field.key)) telemetryKeys.push(field.key);
    });

    const telemetry = telemetryKeys.map((key) => {
        const meta = telemetryMeta(key);
        const raw = props[key];
        return {
            key,
            label: meta.label,
            icon: meta.icon,
            color: meta.color,
            bars: meta.bars ?? false,
            value: meta.text
                ? (HVAC_ACTIONS[raw] ?? raw ?? '-')
                : format(raw, meta.unit ?? ''),
        };
    });

    return {
        // Writable keys (used by `setProperty`) + the current values.
        temperatureKey: tempField?.key,
        temperature: Number(valueOf(tempField, 21)),
        modeKey: modeField?.key,
        modeValue: modeRaw,
        fanKey: fanField?.key,
        fanValue: valueOf(fanField, 'auto'),

        minTemp: tempField?.min ?? DEFAULT_TEMP_RANGE.min,
        maxTemp: tempField?.max ?? DEFAULT_TEMP_RANGE.max,
        step: tempField?.step ?? DEFAULT_TEMP_RANGE.step,

        mode: {
            ...modeMeta(modeRaw),
            ...(modeOption?.label ? { label: modeOption.label } : {}),
        },

        // Real per-unit option lists only — no device-specific vocabulary here.
        modeOptions: (modeField?.options ?? []).map((option) => ({
            ...modeMeta(option.value),
            label: option.label ?? modeMeta(option.value).label,
        })),
        fanSpeedOptions: fanField?.options ?? [],

        // Orientation rows (empty lists -> the panel hides them).
        swingKey: swingField?.key,
        swingValue: valueOf(swingField),
        swingOptions: swingField?.options ?? [],
        swingHorizontalKey: swingHorizontalField?.key,
        swingHorizontalValue: valueOf(swingHorizontalField),
        swingHorizontalOptions: swingHorizontalField?.options ?? [],

        // Only the telemetry the device actually reports (built above).
        telemetry,
    };
};

export default climatePresentation;
