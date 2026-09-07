import React from 'react';
import { Typography } from '@mui/material';
import { TypePanel } from './typeShell';
import { updateState } from '../utils';
import { DebouncedSlider } from '../DebouncedSlider';
import { SECTION_LABEL, TYPE_COLORS } from './typeStyles';

/**
 * Default `light` control panel: power button + brightness slider.
 */
export const LightControls = ({ device, onStateChange }) => {
    const state = device?.state ?? {};
    const power = state?.power === 'on';
    const level = state?.level ?? 0;

    const setPower = (on) =>
        updateState(device, { power: on ? 'on' : 'off' }, onStateChange);
    const setLevel = (next) =>
        updateState(device, { level: next }, onStateChange);

    return (
        <TypePanel
            type="light"
            title="Lampe"
            power={power}
            onTogglePower={setPower}
        >
            <Typography sx={SECTION_LABEL}>Luminosité</Typography>
            <DebouncedSlider
                value={power ? level : 0}
                min={0}
                max={100}
                step={1}
                size="small"
                disabled={!power}
                valueLabelDisplay="auto"
                onChangeCommitted={setLevel}
                sx={{ color: TYPE_COLORS.light }}
            />
            <Typography
                variant="body2"
                sx={{ color: 'text.secondary', mt: 0.5 }}
            >
                {power
                    ? `Niveau réglé à ${level}%`
                    : 'Allumez la lampe pour régler la luminosité.'}
            </Typography>
        </TypePanel>
    );
};

export default LightControls;