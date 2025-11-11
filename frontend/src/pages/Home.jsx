import React from 'react';
import { SpeedDialAdd } from '../components/SpeedDialAdd';
import DevicesIcon from '@mui/icons-material/Devices';
import RoomPreferencesIcon from '@mui/icons-material/RoomPreferences';
import AutoModeIcon from '@mui/icons-material/AutoMode';
import { useNavigate } from 'react-router-dom';
import { RoomsList } from '../components/Rooms';
import { api } from '../api/charlie';

export const HomePage = () => {
    const navigate = useNavigate();
    return (
        <>
            <SpeedDialAdd
                actions={[
                    {
                        icon: <DevicesIcon />,
                        name: 'Devices',
                        click: () => navigate('/discovery'),
                    },
                    {
                        icon: <RoomPreferencesIcon />,
                        name: 'Rooms',
                        click: async () => {
                            const { uuid } = await api('rooms', {
                                method: 'POST',
                                body: JSON.stringify({ name: 'Untitled room' }),
                            });
                            navigate(`/room/${uuid}`);
                        },
                    },
                    {
                        icon: <AutoModeIcon />,
                        name: 'Routines',
                        click: () => navigate('/routines'),
                    },
                ]}
            />
            <RoomsList />
        </>
    );
};
