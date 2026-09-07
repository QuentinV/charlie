import React from 'react';
import { Typography } from '@mui/material';
import { TypePanel } from './typeShell';
import { updateState } from '../utils';

/**
 * Default `sprinkler` control panel: simple power toggle. The watering
 * duration is configured via routines, so no duration slider here.
 */
export const SprinklerControls = ({ device, onStateChange }) => {
    const state = device?.state ?? {};
    const power = state?.power === 'on';

    const setPower = (on) =>
        updateState(device, { power: on ? 'on' : 'off' }, onStateChange);

    return (
        <TypePanel
            type="sprinkler"
            title="Arrosage"
            power={power}
            onTogglePower={setPower}
        >
            <Typography variant="body2" color="text.secondary">
                La durée d’arrosage est configurée dans les routines.
            </Typography>
        </TypePanel>
    );
};

export default SprinklerControls;