import {
    Card,
    CardContent,
    FormControl,
    Grid,
    InputLabel,
    MenuItem,
    Select,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/charlie';

let timeout = null;

export const ViewDevice = ({ deviceId }) => {
    const [data, setData] = useState(null);
    const [roomId, setRoomId] = useState(null);
    const [rooms, setRooms] = useState([]);
    const [providers, setProviders] = useState([]);

    useEffect(() => {
        (async () => {
            const device = await api(`devices/${deviceId}`);
            setData(device ?? null);

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

    const toggleState = async (power) => {
        const res = (
            await api(`devices/${deviceId}/state`, {
                method: 'PUT',
                body: JSON.stringify({ power }),
            })
        )?.res;

        if (res) {
            setData({ ...data, state: { power } });
        }
    };

    if (!data) return null;
    const { _id, name, externalId, provider, type, state } = data;

    return (
        <Card sx={{ maxWidth: 600 }}>
            <CardContent>
                <Grid container spacing={2}>
                    <Typography variant="h6" gutterBottom>
                        {name}
                    </Typography>

                    <Switch
                        checked={state?.power === 'on'}
                        onChange={() =>
                            toggleState(state?.power === 'on' ? 'off' : 'on')
                        }
                        color="primary"
                    />
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
                            label="Name"
                            value={name}
                            onChange={(event) => {
                                const d = { ...data, name: event.target.value };
                                setData(d);
                                debouncedUpdate(d);
                            }}
                            fullWidth
                        />
                    </Grid>

                    <Grid>
                        <FormControl fullWidth>
                            <InputLabel>Type</InputLabel>
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
                                <MenuItem value="light">Light</MenuItem>
                                <MenuItem value="switch">Switch</MenuItem>
                                <MenuItem value="shutter">Shutter</MenuItem>
                                <MenuItem value="sensor">Sensor</MenuItem>
                                <MenuItem value="sprinkler">Sprinkler</MenuItem>
                                <MenuItem value="thermostat">
                                    Thermostat
                                </MenuItem>
                                <MenuItem value="other">Other</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>

                    <Grid>
                        <FormControl fullWidth>
                            <InputLabel>Provider</InputLabel>
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
                                    <MenuItem value={p._id}>{p.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
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

                    <Grid>
                        <FormControl fullWidth>
                            <InputLabel>Room</InputLabel>
                            <Select
                                value={roomId}
                                label="Room"
                                onChange={(event) => {
                                    setRoomId(event.target.value);
                                    changeRoom(event.target.value);
                                }}
                            >
                                {rooms?.map((r) => (
                                    <MenuItem value={r._id}>{r.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                </Grid>
            </CardContent>
        </Card>
    );
};

/*
  <Divider sx={{ my: 3 }} />
 <Typography variant="h6" gutterBottom>
                    Raw State
                </Typography>
  <Table size="small">
                    <TableBody>
                        {Object.entries(form.rawState).map(([key, value]) => (
                            <TableRow key={key}>
                                <TableCell sx={{ fontWeight: 600 }}>
                                    {key}
                                </TableCell>
                                <TableCell>{String(value)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
*/
