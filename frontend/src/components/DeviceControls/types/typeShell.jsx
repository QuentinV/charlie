import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { GOLD, TYPE_COLORS } from './typeStyles';
import { PowerButton } from '../primitives/PowerButton';

/**
 * Shared container for the per-device-type control panels. Frameless on
 * purpose: the device detail view already wraps the controls in a Card, so
 * this only lays out the header (type title) + optional on/off power button
 * and the type-specific body in `children`. `device`/`onStateChange` mirror
 * the provider `CUSTOM_CONTROLS` contract so every type panel is a drop-in
 * replacement in `DeviceControls`.
 */
export const TypePanel = ({
    type,
    title,
    color,
    power = false,
    onTogglePower = null,
    children,
}) => {
    const accent = color ?? TYPE_COLORS[type] ?? GOLD;

    return (
        <Box className="no-select" sx={{ width: '100%' }}>
            {(title || onTogglePower) && (
                <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                >
                    <Box>
                        {title && (
                            <Typography
                                sx={{
                                    fontSize: 13,
                                    letterSpacing: 2,
                                    textTransform: 'uppercase',
                                    color: alpha(accent, 0.85),
                                    fontWeight: 700,
                                }}
                            >
                                {title}
                            </Typography>
                        )}
                    </Box>

                    {onTogglePower && (
                        <PowerButton
                            variant="outline"
                            power={power}
                            size={46}
                            onToggle={onTogglePower}
                        />
                    )}
                </Stack>
            )}

            <Box sx={{ mt: title || onTogglePower ? 1 : 0 }}>{children}</Box>
        </Box>
    );
};

/**
 * Readonly telemetry/display row used by the sensor & other readout panels.
 */
export const ReadoutRow = ({
    label,
    value,
    unit = '',
    icon: Icon = null,
    color = GOLD,
}) => (
    <Box
        sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 1,
            py: 0.75,
            my: 0.5,
            borderRadius: 1,
            bgcolor: 'rgba(255,255,255,0.03)',
        }}
    >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {Icon && <Icon sx={{ fontSize: 18, color }} />}
            <Typography variant="body2" color="text.secondary">
                {label}
            </Typography>
        </Box>
        <Typography
            variant="body2"
            sx={{ fontWeight: 700, color }}
        >
            {value !== undefined && value !== null
                ? `${value}${unit ? ` ${unit}` : ''}`
                : '-'}
        </Typography>
    </Box>
);

export default TypePanel;