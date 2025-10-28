import React, { useEffect, useState } from 'react';
import {
    Box,
    List,
    ListItem,
    ListItemText,
    Divider,
    Chip,
    ListItemIcon,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import DeviceThermostatIcon from '@mui/icons-material/DeviceThermostat';
import TvIcon from '@mui/icons-material/Tv';
import PowerIcon from '@mui/icons-material/Power';
import OutletIcon from '@mui/icons-material/Outlet';
import SwitchLeftIcon from '@mui/icons-material/SwitchLeft';
import GarageIcon from '@mui/icons-material/Garage';
import ShowerIcon from '@mui/icons-material/Shower';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import FenceIcon from '@mui/icons-material/Fence';
import DoorbellIcon from '@mui/icons-material/Doorbell';
import FullScreenDialog from '../FullScreenDialog';
import { ViewDevice } from './View';
import { api } from '../../api/charlie';

const iconFromType = (type) => {
    switch (type ?? '') {
        case 'tv':
            return <TvIcon />;
        case 'light':
            return <LightbulbIcon />;
        default:
            return <PowerIcon />;
    }
};

export const DevicesList = ({ devices }) => {
    const [selected, setSelected] = useState(null);
    const [devicesState, setDevicesState] = useState(devices);

    useEffect(() => {
        setDevicesState(devices);
    }, [devices]);

    const toggleState = async (id) => {
        const device = devicesState.find((d) => d._id === id);
        const power = device.state?.power === 'on' ? 'off' : 'on';
        const res = (
            await api(`devices/${id}/state`, {
                method: 'PUT',
                body: JSON.stringify({ power }),
            })
        )?.res;

        if (res) {
            device.state = res;
            setDevicesState([...devices]);
        }
    };

    return (
        <>
            <List dense>
                {devicesState.map((device, index) => (
                    <Box key={device.name}>
                        <ListItem
                            secondaryAction={
                                <Chip
                                    label={
                                        device?.state?.power === 'on'
                                            ? 'On'
                                            : 'Off'
                                    }
                                    color={
                                        device?.state?.power === 'on'
                                            ? 'success'
                                            : 'default'
                                    }
                                    size="small"
                                    onClick={() => toggleState(device._id)}
                                />
                            }
                        >
                            <ListItemIcon>
                                {iconFromType(device.type)}
                            </ListItemIcon>
                            <ListItemText
                                primary={device.name}
                                onClick={() => setSelected(device)}
                                sx={{ cursor: 'pointer' }}
                            />
                        </ListItem>
                        {index < devices.length - 1 && <Divider />}
                    </Box>
                ))}
            </List>
            {!!selected && (
                <FullScreenDialog
                    open={!!selected}
                    handleClose={() => setSelected(null)}
                    title="Devices"
                >
                    <ViewDevice deviceId={selected._id} />
                </FullScreenDialog>
            )}
        </>
    );
};
