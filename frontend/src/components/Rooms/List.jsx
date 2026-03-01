import React, { useEffect, useState } from 'react';
import { DevicesList } from '../Devices';
import { Card, CardContent, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/charlie';

export const RoomsList = () => {
    const navigate = useNavigate();
    const [rooms, setRooms] = useState([]);

    useEffect(() => {
        (async () => {
            const devices = (await api('devices')).reduce((p, d) => {
                p[d._id] = d;
                return p;
            }, {});

            const rooms = await api('rooms');
            rooms
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach((room) => {
                    room.devices =
                        room.devices
                            ?.map((d) => devices[d])
                            ?.sort((a, b) => (a.name > b.name ? 1 : -1)) ?? [];
                });

            rooms.push({
                name: 'Maison',
                devices: Object.entries(devices ?? {})
                    .filter(
                        ([d]) =>
                            !rooms.some((r) =>
                                r.devices?.some((rd) => rd._id === d)
                            )
                    )
                    .map(([_, d]) => d),
            });

            setRooms(rooms);
        })();
    }, []);

    return (
        <>
            {rooms.map((r) => (
                <Card sx={{ mb: 2, borderRadius: 3 }} key={r._id ?? 'unknown'}>
                    <CardContent>
                        {r.name && (
                            <Typography
                                variant="h6"
                                gutterBottom
                                onClick={() =>
                                    r._id && navigate(`/room/${r._id}`)
                                }
                                sx={{ cursor: 'pointer' }}
                            >
                                {r.name}
                            </Typography>
                        )}
                        <DevicesList devices={r.devices} />
                    </CardContent>
                </Card>
            ))}
        </>
    );
};
