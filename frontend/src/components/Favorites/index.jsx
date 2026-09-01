import React from 'react';
import {
    Box,
    Card,
    Typography,
    alpha,
    useTheme,
    useMediaQuery,
} from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import { DevicesList } from '../Devices';

/**
 * @param {{
 *   devices: any[];
 *   favoriteDeviceIds: string[];
 *   onToggleFavorite: (device: any) => void;
 * }} props
 */
export const FavoritesSection = ({
    devices,
    favoriteDeviceIds,
    onToggleFavorite,
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    const favoriteDevices = devices.filter((d) =>
        favoriteDeviceIds.includes(d._id)
    );

    if (favoriteDevices.length === 0) return null;

    return (
        <Card
            sx={{
                overflow: 'hidden',
                borderRadius: isMobile ? 2.5 : 3,
            }}
        >
            <Box
                sx={{
                    px: isMobile ? 1 : 1.5,
                    py: isMobile ? 0.5 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                }}
            >
                <Box
                    sx={{
                        width: isMobile ? 32 : 40,
                        height: isMobile ? 32 : 40,
                        borderRadius: isMobile ? 1.5 : 2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: alpha(theme.palette.primary.main, 0.12),
                        color: 'primary.main',
                    }}
                >
                    <StarIcon fontSize={isMobile ? 'small' : 'medium'} />
                </Box>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        variant={isMobile ? 'body1' : 'h6'}
                        sx={{
                            fontWeight: 700,
                            mb: 0,
                            fontSize: isMobile ? '0.875rem' : '1.5rem',
                        }}
                    >
                        Favorites
                    </Typography>
                    <Typography
                        variant="caption"
                        sx={{
                            color: 'text.secondary',
                            fontSize: isMobile ? '0.75rem' : '0.875rem',
                        }}
                    >
                        {favoriteDevices.length} device
                        {favoriteDevices.length > 1 ? 's' : ''} · long-press to
                        unpin
                    </Typography>
                </Box>
            </Box>

            <Box
                sx={{
                    px: isMobile ? 1 : 1.5,
                    pb: isMobile ? 0.5 : 1,
                    pt: isMobile ? 0 : 0.5,
                }}
            >
                <DevicesList
                    devices={favoriteDevices}
                    favoriteDeviceIds={favoriteDeviceIds}
                    onToggleFavorite={onToggleFavorite}
                />
            </Box>
        </Card>
    );
};
