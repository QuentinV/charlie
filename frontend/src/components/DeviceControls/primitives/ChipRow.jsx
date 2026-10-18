import React from 'react';
import { ButtonBase, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { GOLD } from './tokens';

/**
 * Shared selectable chip row (AC modes, fan speeds, TV apps…).
 *
 *  - `card`: stacked icon + label, rounded square — the AC mode selector,
 *  - `pill`: label only, fully rounded — the AC fan-speed selector.
 *
 * Chip styles are the verbatim extraction of the premium AC panel, which is
 * why they support per-option colours (`option.color`) and an inactive-state
 * colour override.
 */
const chipBase = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0.5,
    minWidth: 0,
    flex: 1,
    px: 0.5,
    py: 1,
    borderRadius: 2,
    border: '1px solid transparent',
    transition:
        'background-color .18s ease, color .18s ease, border-color .18s ease, box-shadow .18s ease',
    cursor: 'pointer',
    '&:hover': {
        backgroundColor: 'rgba(255,215,0,0.08)',
    },
    '&.Mui-disabled': {
        opacity: 0.3,
        cursor: 'not-allowed',
    },
};

const activeChip = (color) => ({
    backgroundColor: alpha(color, 0.18),
    borderColor: alpha(color, 0.55),
    boxShadow: `0 0 0 1px ${alpha(color, 0.18)}, 0 4px 18px -6px ${alpha(color, 0.5)}`,
});

export const ChipRow = ({
    options = [],
    value,
    /** Whether the underlying device is powered — chips grey out when not. */
    active = true,
    disabled = false,
    onChange,
    variant = 'card',
    activeColor = GOLD,
    inactiveColor,
    spacing = 0.75,
    stacked = true,
    /** Wrap long rows (e.g. a 11-key remote) instead of squeezing the chips. */
    wrap = false,
}) => {
    const pill = variant === 'pill';

    return (
        <Stack direction="row" spacing={spacing} sx={{ flexWrap: 'wrap' }}>
            {options.map((option) => {
                const Icon = option.icon;
                const isActive = active && value === option.value;
                const color = option.color ?? activeColor;
                const restingColor =
                    inactiveColor ??
                    (pill ? 'rgba(245,245,220,0.6)' : 'rgba(245,245,220,0.55)');

                return (
                    <ButtonBase
                        key={String(option.value)}
                        aria-pressed={isActive}
                        disabled={disabled || !active}
                        onClick={() => onChange?.(option.value)}
                        sx={{
                            ...chipBase,
                            flexDirection: stacked ? 'column' : 'row',
                            borderRadius: pill ? '999px' : 2,
                            ...(wrap ? { flex: '1 1 64px', minWidth: 64 } : {}),
                            color: isActive ? color : restingColor,
                            ...(isActive ? activeChip(color) : {}),
                        }}
                    >
                        {Icon ? <Icon fontSize="small" /> : null}
                        <Typography sx={{ fontSize: 10, lineHeight: 1.1 }}>
                            {option.label}
                        </Typography>
                    </ButtonBase>
                );
            })}
        </Stack>
    );
};

export default ChipRow;
