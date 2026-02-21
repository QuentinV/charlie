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
import { api } from '../../api/charlie';
import { DeviceIcon } from '../DeviceIcon';

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
