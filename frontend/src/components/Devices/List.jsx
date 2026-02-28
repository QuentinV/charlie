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
import FullScreenDialog from '../FullScreenDialog';
import { ViewDevice } from './View';
import { DeviceIcon } from '../DeviceIcon';
import { DeviceToggle } from './Toggle';

export const DevicesList = ({ devices }) => {
    const [selected, setSelected] = useState(null);
    const [devicesState, setDevicesState] = useState(devices);

    useEffect(() => {
        setDevicesState(devices);
    }, [devices]);

    return (
        <>
            <List dense>
                {devicesState.map((device, index) => (
                    <Box key={device.name}>
                        <ListItem
                            secondaryAction={
                                <DeviceToggle
                                    deviceId={device._id}
                                    power={device.state?.power}
                                    type={device.type}
                                    level={device.state?.level}
                                    onStateChange={(newState) => {
                                        device.state = newState;
                                        setDevicesState([...devices]);
                                    }}
                                />
                            }
                        >
                            <ListItemIcon>
                                <DeviceIcon type={device.type} />
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
