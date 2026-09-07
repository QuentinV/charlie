import {
    Card,
    CardContent,
    Divider,
    FormControl,
    Grid,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/charlie';
import { DeviceToggle } from './Toggle';
import { DeviceType } from './constants';
import HistoricalDeviceChart from '../DeviceStateChart';
import { DeviceDetailControls, hasCustomControl } from '../DeviceControls';

let timeout = null;

export const ViewDevice = ({ device }) => {
    const [data, setData] = useState(device);
    const [state, setState] = useState(null);
    const [stateLoading, setStateLoading] = useState(true);
    const [roomId, setRoomId] = useState(null);
    const [rooms, setRooms] = useState([]);
    const [providers, setProviders] = useState([]);
    const [capabilities, setCapabilities] = useState(null);

    const deviceId = device?._id;

    useEffect(() => {
        setData(device);
    }, [device]);

    useEffect(() => {
        if (!deviceId) return;
        (async () => {
            const caps = await api(`devices/${deviceId}/capabilities`).catch(
                () => null
            );
            setCapabilities(caps ?? null);

            const stateRes = await api(`devices/${deviceId}/state`).catch(
                () => null
            );
            setState(stateRes?.state ?? null);
            setStateLoading(false);

            const rooms = await api('rooms');
            setRooms(rooms ?? []);
            setRoomId(
                rooms.find((r) => r.devices?.find((did) => deviceId))?._id ??
                    null
            );

            const provs = await api('providers');
            setProviders(provs);
        })();
    }, [deviceId]);

    const debouncedUpdate = (data) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            const { state, ...rest } = data;
            api(`devices`, {
                method: 'POST',
                body: JSON.stringify(rest),
            });
        }, 500);
    };

    const changeRoom = (roomId) => {
        api(`rooms/${roomId}/devices/${deviceId}`, { method: 'PUT' });
    };

    if (!data) return null;
    const { _id, name, externalId, provider, type } = data;
    const codesource = providers?.find((p) => p._id === provider)?.codesource;

    const hasFunctions = (capabilities?.functions?.length ?? 0) > 0;
    //const controlsFirst = hasCustomControl(type, codesource) || hasFunctions;

    return (
        <Stack spacing={2}>
            {hasFunctions && (
                <Card>
                    <CardContent>
                        <DeviceDetailControls
                            device={data}
                            codesource={codesource}
                            capabilities={capabilities}
                            state={state}
                            loading={stateLoading}
                            onStateChange={(newState) =>
                                newState && setState(newState)
                            }
                        />
                    </CardContent>
                </Card>
            )}
            <Card>
                <CardContent>
                    <Grid container spacing={2} sx={{ alignItems: 'center' }}>
                        <Typography variant="h6" gutterBottom>
                            {name}
                        </Typography>

                        <div>
                            <DeviceToggle
                                deviceId={deviceId}
                                power={state?.power}
                                type={type}
                                level={state?.level}
                                disabled={stateLoading}
                                onStateChange={(newState) =>
                                    newState && setState(newState)
                                }
                            />
                        </div>
                    </Grid>

                    <Grid container direction="column" spacing={1}>
                        <Grid>
                            <TextField
                                label="ID"
                                value={_id}
                                fullWidth
                                InputProps={{ readOnly: true }}
                            />
                        </Grid>

                        <Grid>
                            <TextField
                                label="External ID"
                                value={externalId}
                                fullWidth
                                onChange={(event) => {
                                    const d = {
                                        ...data,
                                        externalId: event.target.value,
                                    };
                                    setData(d);
                                    debouncedUpdate(d);
                                }}
                            />
                        </Grid>

                        <Divider sx={{ my: '5px' }} />

                        <Grid>
                            <TextField
                                label="Name"
                                value={name}
                                onChange={(event) => {
                                    const d = {
                                        ...data,
                                        name: event.target.value,
                                    };
                                    setData(d);
                                    debouncedUpdate(d);
                                }}
                                fullWidth
                            />
                        </Grid>

                        <Grid>
                            <FormControl fullWidth>
                                <InputLabel id="device=type">Type</InputLabel>
                                <Select
                                    value={type}
                                    label="Type"
                                    onChange={(event) => {
                                        const d = {
                                            ...data,
                                            type: event.target.value,
                                        };
                                        setData(d);
                                        debouncedUpdate(d);
                                    }}
                                >
                                    {Object.keys(DeviceType).map((t) => (
                                        <MenuItem value={`${t}`}>{t}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>

                        <Divider sx={{ my: '5px' }} />

                        <Grid>
                            <FormControl fullWidth>
                                <InputLabel id="device-provider">
                                    Provider
                                </InputLabel>
                                <Select
                                    value={provider}
                                    label="Provider"
                                    onChange={(event) => {
                                        const d = {
                                            ...data,
                                            provider: event.target.value,
                                        };
                                        setData(d);
                                        debouncedUpdate(d);
                                    }}
                                >
                                    {providers?.map((p) => (
                                        <MenuItem value={p._id}>
                                            {p.name}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>

                        <Divider sx={{ my: '5px' }} />

                        <Grid>
                            <FormControl fullWidth>
                                <InputLabel id="device-room">Room</InputLabel>
                                <Select
                                    value={roomId}
                                    label="Room"
                                    onChange={(event) => {
                                        setRoomId(event.target.value);
                                        changeRoom(event.target.value);
                                    }}
                                >
                                    <MenuItem value="">Aucun</MenuItem>
                                    {rooms?.map((r) => (
                                        <MenuItem value={r._id}>
                                            {r.name}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>
            <Card>
                <HistoricalDeviceChart deviceId={_id} />
            </Card>
        </Stack>
    );
};
