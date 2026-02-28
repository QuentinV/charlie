import React, { useMemo } from 'react';
import { SpeedDialAdd } from '../components/SpeedDialAdd';
import DevicesIcon from '@mui/icons-material/Devices';
import RoomPreferencesIcon from '@mui/icons-material/RoomPreferences';
import AutoModeIcon from '@mui/icons-material/AutoMode';
import { useNavigate } from 'react-router-dom';
import { RoomsList } from '../components/Rooms';
import { api } from '../api/charlie';
import { useUnit } from 'effector-react';
import { settingsStore } from '../state/settings';

export const HomePage = () => {
    const navigate = useNavigate();
    const enableAddDevice = useUnit(settingsStore.$enableAddDevice);
    const enableAddRoom = useUnit(settingsStore.$enableAddRoom);
    const enableAddRoutine = useUnit(settingsStore.$enableAddRoutine);

    const actions = useMemo(() => {
        const a = [];
        if (enableAddDevice)
            a.push({
                icon: <DevicesIcon />,
                name: 'Devices',
                click: () => navigate('/discovery'),
            });

        if (enableAddRoom)
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
                click: () => navigate('/routines'),
            });

        return a;
    }, [navigate, enableAddDevice, enableAddRoom, enableAddRoutine]);

    return (
        <>
            <SpeedDialAdd actions={actions} />
            <RoomsList />
        </>
    );
};
