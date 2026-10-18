import React, { useState } from 'react';
import { ButtonBase, Typography } from '@mui/material';
import SmartButtonIcon from '@mui/icons-material/SmartButton';
import { api } from '../../../api/charlie';
import { TypePanel } from './typeShell';
import { GOLD, glow } from './typeStyles';

/**
 * Default `button` control panel: a single large trigger. Uses the same
 * `devices/:id/state/toggle` endpoint as the legacy DeviceToggle button.
 */
export const ButtonControls = ({ device, onStateChange }) => {
    const [busy, setBusy] = useState(false);

    const press = async () => {
        setBusy(true);
        try {
            const res = await api(`devices/${device?._id}/state/toggle`, {
                method: 'PUT',
            });
            if (res) onStateChange?.(res?.state);
        } finally {
            setBusy(false);
        }
    };

    return (
        <TypePanel type="button">
            <ButtonBase
                aria-label="Déclencher"
                onClick={press}
                disabled={busy}
                sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 0.75,
                    width: '100%',
                    py: 2,
                    borderRadius: 2,
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    backgroundImage: `linear-gradient(135deg, ${GOLD}1a, rgba(255,215,0,0.06))`,
                    border: `1px solid ${GOLD}`,
                    color: GOLD,
                    boxShadow: glow(GOLD, 0.2),
                    transition: 'all .18s ease',
                    '&:hover': {
                        backgroundColor: 'rgba(255,215,0,0.15)',
                        boxShadow: glow(GOLD, 0.35),
                    },
                    '&.Mui-disabled': {
                        opacity: 0.5,
                        cursor: 'not-allowed',
                    },
                }}
            >
                <SmartButtonIcon fontSize="large" />
                <Typography sx={{ fontWeight: 700 }}>
                    {busy ? '…' : 'Déclencher'}
                </Typography>
            </ButtonBase>
        </TypePanel>
    );
};

export default ButtonControls;