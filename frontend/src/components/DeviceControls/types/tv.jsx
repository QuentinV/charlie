import React from 'react';
import { Typography } from '@mui/material';
import { TypePanel } from './typeShell';
import { updateState } from '../utils';
import { DebouncedSlider } from '../DebouncedSlider';
import { SECTION_LABEL, TYPE_COLORS } from './typeStyles';

/**
 * Default `tv` control panel: power button + volume slider
 * (`properties.volume_level` when exposed by the provider).
 * Richer vendor panels (e.g. `sony_bravia_tv`) take precedence via
 * `CUSTOM_CONTROLS` in the DeviceControls registry.
 */
export const TVDefaultControls = ({ device, onStateChange }) => {
    const state = device?.state ?? {};
    const props = state?.properties ?? {};
    const power = state?.power === 'on';
    const volume =
        props.volume_level !== undefined
            ? props.volume_level
            : (state?.level ?? 0);

    const setPower = (on) =>
        updateState(device, { power: on ? 'on' : 'off' }, onStateChange);
    const setVolume = (next) =>
        updateState(
            device,
            { properties: { ...props, volume_level: next / 100 } },
            onStateChange
        );

    return (
        <TypePanel
            type="tv"
            title="Téléviseur"
            power={power}
            onTogglePower={setPower}
        >
            <Typography sx={SECTION_LABEL}>Volume</Typography>
            <DebouncedSlider
                value={power ? volume * 100 : 0}
                min={0}
                max={100}
                step={1}
                size="small"
                disabled={!power}
                valueLabelDisplay="auto"
                onChangeCommitted={setVolume}
                sx={{ color: TYPE_COLORS.tv }}
            />
            <Typography
                variant="body2"
                sx={{ color: 'text.secondary', mt: 0.5 }}
            >
                {power
                    ? `Volume réglé à ${volume * 100}%`
                    : 'Allumez le téléviseur pour régler le volume.'}
            </Typography>
        </TypePanel>
    );
};

export default TVDefaultControls;
