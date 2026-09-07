import React from 'react';
import { Typography } from '@mui/material';
import DeviceThermostatIcon from '@mui/icons-material/DeviceThermostat';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import BatteryFullIcon from '@mui/icons-material/BatteryFull';
import DirectionsRunIcon from '@mui/icons-material/DirectionsRun';
import DoorSlidingIcon from '@mui/icons-material/DoorSliding';
import SensorsIcon from '@mui/icons-material/Sensors';
import { TypePanel, ReadoutRow } from './typeShell';
import { TYPE_COLORS } from './typeStyles';

/**
 * Sensor telemetry fields, matched against `state.properties`.
 * Readonly — a sensor exposes measurements, not controls.
 */
const SENSOR_FIELDS = [
    {
        key: 'temperature',
        label: 'Température',
        unit: '°C',
        icon: DeviceThermostatIcon,
    },
    { key: 'humidity', label: 'Humidité', unit: '%', icon: WaterDropIcon },
    { key: 'battery', label: 'Batterie', unit: '%', icon: BatteryFullIcon },
    { key: 'motion', label: 'Mouvement', icon: DirectionsRunIcon },
    { key: 'door', label: 'Porte', icon: DoorSlidingIcon },
];

const formatValue = (value) => {
    if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
    return value;
};

export const SensorControls = ({ device }) => {
    const state = device?.state ?? {};
    const props = state?.properties ?? {};

    const rows = SENSOR_FIELDS
        .map((field) => ({
            ...field,
            value: props[field.key],
        }))
        .filter((field) => field.value !== undefined && field.value !== null);

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
            {hasLevel && (
                <ReadoutRow
                    label="Niveau"
                    value={formatValue(state.level)}
                    unit="%"
                    icon={SensorsIcon}
                    color={TYPE_COLORS.sensor}
                />
            )}
            {rows.map((field) => (
                <ReadoutRow
                    key={field.key}
                    label={field.label}
                    value={formatValue(field.value)}
                    unit={field.unit}
                    icon={field.icon}
                    color={TYPE_COLORS.sensor}
                />
            ))}
        </TypePanel>
    );
};

export default SensorControls;