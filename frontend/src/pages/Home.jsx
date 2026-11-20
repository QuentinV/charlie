import React from 'react';
import { RoomsList } from '../components/Rooms';
import { FavoritesSection } from '../components/Favorites';
import { api } from '../api/charlie';
import { Box, useTheme, useMediaQuery } from '@mui/material';
import { $favoriteDeviceIds, toggleFavorite } from '../state/favorites';
import { useUnit } from 'effector-react';

export const HomePage = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const favoriteDeviceIds = useUnit($favoriteDeviceIds);
    const [allDevices, setAllDevices] = React.useState(
        /** @type {any[]} */ ([])
    );

    // Load all devices for the favorites section
    React.useEffect(() => {
        (async () => {
            try {
                const devices = (await api('devices')) ?? [];
                setAllDevices(devices);
            } catch (e) {
                console.warn('Unable to load devices for favorites', e);
            }
        })();
    }, []);

    /**
     * @param {any} device
     */
    const handleToggleFavorite = (device) => {
        if (device?._id) toggleFavorite(device._id);
    };

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: isMobile ? 1.25 : 2,
            }}
        >
            <FavoritesSection
                devices={allDevices}
                favoriteDeviceIds={favoriteDeviceIds}
                onToggleFavorite={handleToggleFavorite}
            />

            <RoomsList
                favoriteDeviceIds={favoriteDeviceIds}
                onToggleFavorite={handleToggleFavorite}
            />
        </Box>
    );
};
