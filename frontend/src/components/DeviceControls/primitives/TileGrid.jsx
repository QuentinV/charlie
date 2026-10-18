import React from 'react';
import { Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { GOLD, GOLD_DARK } from './tokens';

/**
 * Telemetry tile + grid: the shared "icon in a tinted circle + label + value"
 * card used by the premium panels, with an optional WiFi-style bar indicator.
 * Styles extracted verbatim from the AC panel.
 */
export const Tile = ({
    icon: Icon,
    label,
    value,
    color = GOLD,
    bars = false,
}) => {
    const numeric = Number(value);
    const barColor = numeric > 60 ? '#4CD964' : numeric > 30 ? '#FFB300' : '#FF5D5D';

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                p: 1.25,
                borderRadius: 2,
                background:
                    'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0))',
                bgcolor: 'rgba(3,3,4,0.25)',
                border: '1px solid rgba(255,255,255,0.06)',
            }}
        >
            {Icon ? (
                <Box
                    sx={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color,
                        backgroundColor: alpha(color, 0.14),
                        flexShrink: 0,
                    }}
                >
                    <Icon fontSize="small" />
                </Box>
            ) : null}

            <Box sx={{ minWidth: 0 }}>
                <Typography
                    sx={{
                        fontSize: 10,
                        color: 'text.secondary',
                        letterSpacing: 0.5,
                    }}
                >
                    {label}
                </Typography>
                <Typography
                    sx={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}
                >
                    {value}
                </Typography>
            </Box>

            {bars ? (
                <Box
                    sx={{
                        ml: 'auto',
                        display: 'flex',
                        alignItems: 'flex-end',
                        gap: 0.25,
                        color: barColor,
                    }}
                >
                    {[1, 2, 3].map((bar) => (
                        <Box
                            key={bar}
                            sx={{
                                width: 4,
                                height: 5 + bar * 3,
                                borderRadius: 1,
                                backgroundColor: 'currentColor',
                                opacity: numeric >= bar * 30 ? 1 : 0.25,
                            }}
                        />
                    ))}
                </Box>
            ) : null}
        </Box>
    );
};

export const TileGrid = ({ tiles = [], columns = 2, gap = 1.25, sx }) => (
    <Box
        sx={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap,
            ...(sx ?? {}),
        }}
    >
        {tiles.map((tile) => (
            <Tile key={tile.key} {...tile} />
        ))}
    </Box>
);

export default TileGrid;
