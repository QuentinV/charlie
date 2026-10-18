import React from 'react';
import { Box, Switch, Typography } from '@mui/material';
import { TypePanel } from './typeShell';
import { updateState } from '../utils';
import { SECTION_LABEL, TYPE_COLORS } from './typeStyles';

/**
 * Default `switch` control panel: power button + large state switch.
 */
export const SwitchControls = ({ device, onStateChange }) => {
    const state = device?.state ?? {};
    const power = state?.power === 'on';

    const setPower = (on) =>
        updateState(device, { power: on ? 'on' : 'off' }, onStateChange);

    return (
        <TypePanel
            type="switch"
            title="Interrupteur"
            power={power}
            onTogglePower={setPower}
        >
            <Typography sx={SECTION_LABEL}>État</Typography>
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
                    Alimentation
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
                        {power ? 'ON' : 'OFF'}
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