import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Card,
    CardContent,
    Divider,
    FormControl,
    Grid,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/charlie';
import { DeviceType } from './constants';
import HistoricalDeviceChart from '../DeviceStateChart';
import { DeviceDetailControls } from '../DeviceControls';

let timeout = null;

export const ViewDevice = ({ device }) => {
    const { t } = useTranslation();
    const [data, setData] = useState(device);
    const [state, setState] = useState(null);
    const [stateLoading, setStateLoading] = useState(true);
    const [roomId, setRoomId] = useState(null);
    const [rooms, setRooms] = useState([]);
    const [providers, setProviders] = useState([]);

    const deviceId = device?._id;

    useEffect(() => {
        setData(device);
    }, [device]);

    useEffect(() => {
        if (!deviceId) return;
        (async () => {
            const stateRes = await api(`devices/${deviceId}/state`).catch(
                () => null
            );
            setState(stateRes?.state ?? null);
            setStateLoading(false);

            const rooms = await api('rooms');
            setRooms(rooms ?? []);
            setRoomId(
                rooms.find((r) =>
                    r.devices?.some(
                        (device) =>
                            device === deviceId || device?._id === deviceId
                    )
                )?._id ?? null
            );

            const provs = await api('providers');
            setProviders(provs);
        })();
    }, [deviceId]);

    const debouncedUpdate = (data) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            // The device record is saved without its state: state has its own
            // endpoint (`devices/:id/state`) and the history log.
            const body = { ...data };
            delete body.state;
            api(`devices`, {
                method: 'POST',
                body: JSON.stringify(body),
            });
        }, 500);
    };

    const changeRoom = (roomId) => {
        api(`rooms/${roomId}/devices/${deviceId}`, { method: 'PUT' });
    };

    if (!data) return null;
    const { _id, name, externalId, provider, type } = data;

    return (
        <Stack spacing={2}>
            <Card>
                <CardContent>
                    <DeviceDetailControls
                        device={data}
                        state={state}
                        loading={stateLoading}
                        onStateChange={(newState) =>
                            newState && setState(newState)
                        }
                    />
                </CardContent>
            </Card>
            <Accordion
                defaultExpanded={false}
                sx={{
                    boxShadow: 'none',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2,
                }}
            >
                <AccordionSummary>
                    <Typography variant="h6">{t('device.properties')}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <Grid container direction="column" spacing={1}>
                        <Grid>
                            <TextField
                                label={t('device.id')}
                                value={_id}
                                fullWidth
                                InputProps={{ readOnly: true }}
                            />
                        </Grid>

                        <Grid>
                            <TextField
                                label={t('device.externalId')}
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
                                label={t('common.name')}
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
                                <InputLabel id="device=type">
                                    {t('common.type')}
                                </InputLabel>
                                <Select
                                    value={type}
                                    label={t('common.type')}
                                    onChange={(event) => {
                                        const d = {
                                            ...data,
                                            type: event.target.value,
                                        };
                                        setData(d);
                                        debouncedUpdate(d);
                                    }}
                                >
                                    {Object.keys(DeviceType).map((typeKey) => (
                                        <MenuItem value={`${typeKey}`}>
                                            {t(`device.types.${typeKey}`, {
                                                defaultValue: typeKey,
                                            })}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>

                        <Divider sx={{ my: '5px' }} />

                        <Grid>
                            <FormControl fullWidth>
                                <InputLabel id="device-provider">
                                    {t('device.provider')}
                                </InputLabel>
                                <Select
                                    value={provider}
                                    label={t('device.provider')}
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
                                <InputLabel id="device-room">
                                    {t('common.room')}
                                </InputLabel>
                                <Select
                                    value={roomId}
                                    label={t('common.room')}
                                    onChange={(event) => {
                                        setRoomId(event.target.value);
                                        changeRoom(event.target.value);
                                    }}
                                >
                                    <MenuItem value="">{t('common.none')}</MenuItem>
                                    {rooms?.map((r) => (
                                        <MenuItem value={r._id}>
                                            {r.name}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                    </Grid>
                </AccordionDetails>
            </Accordion>
            <Card>
                <HistoricalDeviceChart deviceId={_id} />
            </Card>
        </Stack>
    );
};
