import React from 'react';
import { Box, Switch, Typography } from '@mui/material';
import { TypePanel } from './typeShell';
import { updateState } from '../utils';
import { SECTION_LABEL, TYPE_COLORS } from './typeStyles';
import { useTranslation } from 'react-i18next';

/**
 * Default `switch` control panel: power button + large state switch.
 */
export const SwitchControls = ({ device, onStateChange }) => {
    const { t } = useTranslation();
    const state = device?.state ?? {};
    const power = state?.power === 'on';

    const setPower = (on) =>
        updateState(device, { power: on ? 'on' : 'off' }, onStateChange);

    return (
        <TypePanel
            type="switch"
            title={t('deviceControls.type.switch')}
            power={power}
            onTogglePower={setPower}
        >
            <Typography sx={SECTION_LABEL}>
                {t('deviceControls.state')}
            </Typography>
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
                    {t('common.power')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography
                        variant="subtitle1"
                        sx={{
                            fontWeight: 700,
                            color: power
                                ? TYPE_COLORS.switch
                                : 'text.secondary',
                        }}
                    >
                        {power ? t('values.on') : t('values.off')}
                    </Typography>
                    <Switch
                        checked={power}
                        onChange={(event) => setPower(event.target.checked)}
                        color="primary"
                    />
                </Box>
            </Box>
        </TypePanel>
    );
};

export default SwitchControls;