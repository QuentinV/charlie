import React from 'react';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { alpha } from '@mui/material/styles';
import { GOLD, GOLD_DARK, glow } from './tokens';

/**
 * −/+ stepper with the value in between, shared by the climate panels.
 *
 *  - `plain` (default): the per-type panel look (outlined round buttons),
 *  - `gradient`: the premium AC look (gold-tinted gradient round buttons).
 *
 * Styling is the verbatim extraction of both panels; `disableAtBounds` is opt-in
 * because the type panels clamp silently while the AC panel greys out the arrow.
 */
const BUTTON_SX = {
    plain: (color, size) => ({
        width: size,
        height: size,
        borderRadius: '50%',
        minWidth: 0,
        color: 'rgba(245,245,220,0.55)',
        backgroundColor: 'transparent',
        border: `1px solid ${alpha(color, 0.35)}`,
        transition: 'all .25s ease',
        '&:hover': { backgroundColor: alpha(color, 0.3) },
        '&.Mui-disabled': { opacity: 0.35, cursor: 'not-allowed' },
    }),
    gradient: (_color, size) => ({
        width: size,
        height: size,
        borderRadius: '50%',
        color: GOLD_DARK,
        backgroundColor: `linear-gradient(135deg, ${alpha(GOLD, 0.16)}, ${alpha(GOLD, 0.05)})`,
        border: '1px solid rgba(255,215,0,0.3)',
        '&.Mui-disabled': {
            color: 'rgba(245,245,220,0.2)',
            borderColor: 'rgba(245,245,220,0.08)',
            cursor: 'not-allowed',
        },
        '&:hover:not(.Mui-disabled)': {
            backgroundColor: `linear-gradient(135deg, ${alpha(GOLD, 0.28)}, ${alpha(GOLD, 0.08)})`,
            boxShadow: glow(GOLD, 0.3),
        },
    }),
};

const VALUE_SX = {
    plain: (dimmed, color) => ({
        fontWeight: 700,
        color: dimmed ? 'text.secondary' : color,
    }),
    gradient: (dimmed) => ({
        fontSize: 22,
        fontWeight: 700,
        color: dimmed ? 'rgba(245,245,220,0.45)' : '#F5F5DC',
    }),
};

export const Stepper = ({
    value,
    min = 0,
    max = 100,
    step = 1,
    disabled = false,
    dimmed = false,
    disableAtBounds = false,
    onChange,
    variant = 'plain',
    color = GOLD,
    size = variant === 'gradient' ? 44 : 52,
    display = value,
    caption,
    captionSx,
    slotSx,
    spacing = variant === 'gradient' ? 3 : 2,
    ariaLabels = { decrease: 'Diminuer', increase: 'Augmenter' },
}) => {
    const numeric = Number(value);
    const apply = (direction) => {
        const next = Math.min(
            max,
            Math.max(min, (Number.isFinite(numeric) ? numeric : min) + direction * step)
        );
        if (next !== numeric) onChange?.(next);
    };

    const atMin = disableAtBounds && numeric <= min;
    const atMax = disableAtBounds && numeric >= max;
    const variantSx = (BUTTON_SX[variant] ?? BUTTON_SX.plain)(color, size);

    return (
        <Stack
            direction="row"
            alignItems="center"
            justifyContent="center"
            spacing={spacing}
            sx={{ py: 1 }}
        >
            <ButtonBase
                aria-label={ariaLabels.decrease}
                disabled={disabled || atMin}
                onClick={() => apply(-1)}
                sx={variantSx}
            >
                <RemoveIcon fontSize="small" />
            </ButtonBase>

            <Box sx={{ textAlign: 'center', ...(slotSx ?? {}) }}>
                <Typography
                    variant={variant === 'gradient' ? undefined : 'h3'}
                    sx={(VALUE_SX[variant] ?? VALUE_SX.plain)(dimmed, color)}
                >
                    {display}
                </Typography>
                {caption ? (
                    <Typography
                        variant={variant === 'gradient' ? undefined : 'caption'}
                        color="text.secondary"
                        sx={captionSx}
                    >
                        {caption}
                    </Typography>
                ) : null}
            </Box>

            <ButtonBase
                aria-label={ariaLabels.increase}
                disabled={disabled || atMax}
                onClick={() => apply(1)}
                sx={variantSx}
            >
                <AddIcon fontSize="small" />
            </ButtonBase>
        </Stack>
    );
};

export default Stepper;
