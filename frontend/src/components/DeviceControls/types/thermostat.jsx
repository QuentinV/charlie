import React from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { TypePanel } from './typeShell';
import { updateState } from '../utils';
import { SECTION_LABEL, TYPE_COLORS, roundButton } from './typeStyles';

const MIN_TEMP = 16;
const MAX_TEMP = 30;
const STEP = 0.5;

/**
 * Default `thermostat` control panel: power button + target-temperature
 * stepper (`properties.targetTemperature`). The `clim` (Mitsubishi) provider
 * override takes precedence via `CUSTOM_CONTROLS` in the registry.
 */
export const ThermostatControls = ({ device, onStateChange }) => {
    const state = device?.state ?? {};
    const props = state?.properties ?? {};
    const power = state?.power === 'on';
    const target = Number(props.targetTemperature ?? 21);
    const mode = props.operationMode ?? 'auto';

    const setPower = (on) =>
        updateState(device, { power: on ? 'on' : 'off' }, onStateChange);
    const setTarget = (next) =>
        updateState(
            device,
            { properties: { ...props, targetTemperature: next } },
            onStateChange
        );
    const adjust = (dir) =>
        setTarget(Math.min(MAX_TEMP, Math.max(MIN_TEMP, target + dir * STEP)));

    return (
        <TypePanel
            type="thermostat"
            title="Thermostat"
            power={power}
            onTogglePower={setPower}
        >
            <Typography sx={SECTION_LABEL}>Température cible</Typography>

            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    my: 0.5,
                }}
            >
                <ButtonBase
                    aria-label="Diminuer la température"
                    onClick={() => adjust(-1)}
                    disabled={!power}
                    sx={{
                        ...roundButton(TYPE_COLORS.thermostat),
                        width: 52,
                        height: 52,
                    }}
                >
                    <RemoveIcon fontSize="small" />
                </ButtonBase>

                <Box sx={{ textAlign: 'center' }}>
                    <Typography
                        variant="h3"
                        sx={{
                            fontWeight: 700,
                            color: power
                                ? TYPE_COLORS.thermostat
                                : 'text.secondary',
                        }}
                    >
                        {target}°C
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        Consigne
                    </Typography>
                </Box>

                <ButtonBase
                    aria-label="Augmenter la température"
                    onClick={() => adjust(1)}
                    disabled={!power}
                    sx={{
                        ...roundButton(TYPE_COLORS.thermostat),
                        width: 52,
                        height: 52,
                    }}
                >
                    <AddIcon fontSize="small" />
                </ButtonBase>
            </Box>

            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    px: 1,
                    py: 0.75,
                    borderRadius: 1,
                    bgcolor: 'rgba(255,255,255,0.03)',
                }}
            >
                <Typography variant="body2" color="text.secondary">
                    Mode
                </Typography>
                <Typography
                    variant="subtitle1"
                    sx={{ fontWeight: 700, color: TYPE_COLORS.thermostat }}
                >
                    {mode}
                </Typography>
            </Box>
        </TypePanel>
    );
};

export default ThermostatControls;