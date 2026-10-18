import React from 'react';
import { Typography } from '@mui/material';
import DeviceThermostatIcon from '@mui/icons-material/DeviceThermostat';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import BatteryFullIcon from '@mui/icons-material/BatteryFull';
import DirectionsRunIcon from '@mui/icons-material/DirectionsRun';
import DoorSlidingIcon from '@mui/icons-material/DoorSliding';
import SensorsIcon from '@mui/icons-material/Sensors';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import { TypePanel, ReadoutRow } from './typeShell';
import { TYPE_COLORS } from './typeStyles';

/**
 * Sensor telemetry — icon/label hints for the common measurement classes.
 *
 * Keys are HA's own `device_class` values, which is also the property name the
 * provider publishes the reading under (`properties.temperature`, …). Every
 * other measurement the gateway reports is rendered generically from the
 * properties bag, so nothing provider-specific lives here.
 */
const SENSOR_FIELDS = [
    {
        key: 'temperature',
        label: 'Température',
        icon: DeviceThermostatIcon,
    },
    { key: 'humidity', label: 'Humidité', icon: WaterDropIcon },
    { key: 'battery', label: 'Batterie', icon: BatteryFullIcon },
    { key: 'motion', label: 'Mouvement', icon: DirectionsRunIcon },
    { key: 'door', label: 'Porte', icon: DoorSlidingIcon },
    { key: 'energy', label: 'Énergie', icon: FlashOnIcon },
    { key: 'power', label: 'Alimentation', icon: PowerSettingsNewIcon },
];

/** Bookkeeping keys of the properties bag — not measurements. */
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
const humanise = (key) =>
    key
        .replace(/_/g, ' ')
        .replace(/^./, (character) => character.toUpperCase());

const formatValue = (value) => {
    if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
    return value;
};

export const SensorControls = ({ device }) => {
    const state = device?.state ?? {};
    const props = state?.properties ?? {};

    // The reading's unit comes from the payload when the gateway publishes one;
    // the hint above is only a fallback for classes that usually carry it.
    const unit = props.unit_of_measurement;

    const rows = SENSOR_FIELDS.map((field) => ({
        ...field,
        value: props[field.key],
    })).filter((field) => field.value !== undefined && field.value !== null);

    Object.entries(props).forEach(([key, value]) => {
        if (NON_MEASUREMENT.has(key)) return;
        if (rows.some((row) => row.key === key)) return;
        if (value === null || typeof value === 'object') return;
        rows.push({
            key,
            label: humanise(key),
            icon: SensorsIcon,
            value,
        });
    });

    const hasLevel = state?.level !== undefined && state?.level !== null;

    return (
        <TypePanel type="sensor">
            {!rows.length && !hasLevel && (
                <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ py: 1 }}
                >
                    Aucune mesure disponible.
                </Typography>
            )}
            {/* `level` is the canonical numeric value, i.e. the reading itself:
                it is the fallback readout when the payload publishes no named
                measurement (the unit is the gateway's, never a percentage). */}
            {hasLevel && !rows.length && (
                <ReadoutRow
                    label="Niveau"
                    value={formatValue(state.level)}
                    unit={unit}
                    icon={SensorsIcon}
                    color={TYPE_COLORS.sensor}
                />
            )}
            {rows.map((field) => (
                <ReadoutRow
                    key={field.key}
                    label={field.label}
                    value={formatValue(field.value)}
                    unit={field.unit ?? unit}
                    icon={field.icon}
                    color={TYPE_COLORS.sensor}
                />
            ))}
        </TypePanel>
    );
};

export default SensorControls;
