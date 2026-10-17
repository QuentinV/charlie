import React from 'react';
import { ButtonBase } from '@mui/material';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import { alpha } from '@mui/material/styles';
import { GOLD, GOLD_LIGHT, GOLD_DARK, glow } from './tokens';

/**
 * Round power toggle, shared by every panel.
 *
 * Two visual variants, both extracted verbatim from the panels they replace:
 *  - `outline`: the per-type panel look (gold-tinted transparent circle),
 *  - `gradient`: the premium AC hero look (solid gold gradient when on).
 */
const VARIANTS = {
    outline: (power) => ({
        color: power ? GOLD_DARK : 'rgba(245,245,220,0.55)',
        backgroundColor: power ? alpha(GOLD, 0.22) : 'transparent',
        border: `1px solid ${alpha(GOLD, 0.35)}`,
        boxShadow: power ? glow(GOLD, 0.25) : 'none',
        '&:hover': { backgroundColor: alpha(GOLD, 0.3) },
    }),
    gradient: (power) => ({
        color: power ? GOLD_DARK : 'rgba(245,245,220,0.55)',
        backgroundColor: power
            ? `linear-gradient(135deg, ${GOLD_LIGHT} 0%, ${GOLD} 50%, ${GOLD_DARK} 100%)`
            : 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,215,0,0.25)',
        boxShadow: power ? glow(GOLD, 0.4) : 'none',
        '&:hover': {
            backgroundColor: power
                ? `linear-gradient(135deg, ${GOLD} 0%, ${GOLD} 60%, ${GOLD_DARK} 100%)`
                : 'rgba(255,255,255,0.12)',
        },
    }),
};

export const PowerButton = ({
    power = false,
    onToggle,
    variant = 'outline',
    size = 46,
    disabled = false,
    ariaLabel,
}) => (
    <ButtonBase
        aria-label={
            ariaLabel ?? (power ? 'Éteindre' : 'Allumer')
        }
        disabled={disabled}
        onClick={() => onToggle?.(!power)}
        sx={{
            width: size,
            height: size,
            borderRadius: '50%',
            minWidth: 0,
            transition: 'all .25s ease',
            '&.Mui-disabled': { opacity: 0.35, cursor: 'not-allowed' },
            ...(VARIANTS[variant] ?? VARIANTS.outline)(power),
        }}
    >
        <PowerSettingsNewIcon fontSize="small" />
    </ButtonBase>
);

export default PowerButton;
