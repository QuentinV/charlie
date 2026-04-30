import React, { useMemo } from 'react';
import { SpeedDialAdd } from '../components/SpeedDialAdd';
import DevicesIcon from '@mui/icons-material/Devices';
import RoomPreferencesIcon from '@mui/icons-material/RoomPreferences';
import AutoModeIcon from '@mui/icons-material/AutoMode';
import { useNavigate } from 'react-router-dom';
import { RoomsList } from '../components/Rooms';
import { api } from '../api/charlie';
import { useSetting } from '../state/settingsHooks';

export const HomePage = () => {
    const navigate = useNavigate();
    const enableAddDevice = useSetting('experimental.devices.add.enabled');
    const enableAddRoutine = useSetting('routines.add.enabled');

    const actions = useMemo(() => {
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

    return (
        <>
            <SpeedDialAdd actions={actions} />
            <RoomsList />
        </>
    );
};
