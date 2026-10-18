import React from 'react';
import { SpeedDialAdd } from '../components/SpeedDialAdd';
import DevicesIcon from '@mui/icons-material/Devices';
import RoomPreferencesIcon from '@mui/icons-material/RoomPreferences';
import AutoModeIcon from '@mui/icons-material/AutoMode';
import { useNavigate } from 'react-router-dom';
import { RoomsList } from '../components/Rooms';
import { FavoritesSection } from '../components/Favorites';
import { api } from '../api/charlie';
import { useSetting } from '../state/settingsHooks';
import { Box, useTheme, useMediaQuery } from '@mui/material';
import { setAddActions } from '../state/addActions';
import { $favoriteDeviceIds, toggleFavorite } from '../state/favorites';
import { useUnit } from 'effector-react';

export const HomePage = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const navigate = useNavigate();
    const enableAddDevice = useSetting('experimental.devices.add.enabled');
    const enableAddRoutine = useSetting('routines.enabled');
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

    /** @type {Array<{icon: React.ReactNode; name: string; click: () => void}>} */
    const actions = React.useMemo(() => {
        /** @type {Array<{icon: React.ReactNode; name: string; click: () => void}>} */
        const a = [];
        if (enableAddDevice)
            a.push({
                icon: <DevicesIcon />,
                name: 'Devices',
                click: () => navigate('/discovery'),
            });

        a.push({
            icon: <RoomPreferencesIcon />,
            name: 'Rooms',
            click: async () => {
                const { uuid } = await api('rooms', {
                    method: 'POST',
                    body: JSON.stringify({
                        name: 'Untitled room',
                    }),
                });
                navigate(`/room/${uuid}`);
            },
        });

        if (enableAddRoutine)
            a.push({
                icon: <AutoModeIcon />,
                name: 'Routines',
                click: () => {
                    navigate(`/routine/new`);
                },
            });

        return a;
    }, [navigate, enableAddDevice, enableAddRoutine]);

    // Register shared quick-add actions for the mobile bottom FAB
    React.useEffect(() => {
        setAddActions(actions);
        return () => {
            setAddActions(
                /** @type {Array<{icon: React.ReactNode; name: string; click: () => void}>} */ ([])
            );
        };
    }, [actions]);

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
            {!isMobile && <SpeedDialAdd actions={actions} />}

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
