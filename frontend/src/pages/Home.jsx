import React from 'react';
import { SpeedDialAdd } from '../components/SpeedDialAdd';
import DevicesIcon from '@mui/icons-material/Devices';
import RoomPreferencesIcon from '@mui/icons-material/RoomPreferences';
import AutoModeIcon from '@mui/icons-material/AutoMode';
import { useNavigate } from 'react-router-dom';
import { RoomsList } from '../components/Rooms';

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
                    { icon: <RoomPreferencesIcon />, name: 'Rooms' },
                    { icon: <AutoModeIcon />, name: 'Routines' },
                ]}
            />
            <RoomsList />
        </>
    );
};
