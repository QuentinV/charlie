import React from 'react';
import { Typography } from '@mui/material';
import { TypePanel } from './typeShell';
import { updateState } from '../utils';
import { useTranslation } from 'react-i18next';

/**
 * Default `sprinkler` control panel: simple power toggle. The watering
 * duration is configured via routines, so no duration slider here.
 */
export const SprinklerControls = ({ device, onStateChange }) => {
    const { t } = useTranslation();
    const state = device?.state ?? {};
    const power = state?.power === 'on';

    const setPower = (on) =>
        updateState(device, { power: on ? 'on' : 'off' }, onStateChange);

    return (
        <TypePanel
            type="sprinkler"
            title={t('deviceControls.type.sprinkler')}
            power={power}
            onTogglePower={setPower}
        >
            <Typography variant="body2" color="text.secondary">
                {t('deviceControls.sprinklerHint')}
            </Typography>
        </TypePanel>
    );
};

export default SprinklerControls;