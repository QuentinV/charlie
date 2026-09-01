import React, { useEffect, useState } from 'react';
import { api } from '../api/charlie';
import { useNavigate, useParams } from 'react-router-dom';
import { DevicesList } from '../components/Devices';
import {
    Box,
    CircularProgress,
    IconButton,
    TextField,
    Typography,
    Tooltip,
    alpha,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

export const RoomPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [devices, setDevices] = useState(/** @type {any[] | null} */ (null));
    const [room, setRoom] = useState(/** @type {any} */ (null));
    const [roomName, setRoomName] = useState(
        /** @type {string | null} */ (null)
    );
    const [isEdit, setIsEdit] = useState(false);

    useEffect(() => {
        (async () => {
            const dev = await api(`devices?roomId=${id}`);
            setDevices(dev);
            const room = await api(`rooms/${id}`);
            setRoom(room);
            setRoomName(room.name);
        })();
    }, [id]);

    if (!room) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    const save = async () => {
        await api(`rooms/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ name: roomName }),
        });
        setIsEdit(false);
    };

    const onDelete = async () => {
        await api(`rooms/${id}`, { method: 'DELETE' });
        navigate('/');
    };

    return (
        <>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    mb: 2,
                    gap: 1,
                }}
            >
                <IconButton
                    aria-label="back"
                    onClick={() => navigate('/')}
                    sx={{
                        borderRadius: 2,
                        bgcolor: alpha('#FFD700', 0.05),
                        '&:hover': {
                            bgcolor: alpha('#FFD700', 0.1),
                        },
                    }}
                >
                    <ArrowBackIcon fontSize="small" />
                </IconButton>
                <Box sx={{ flex: 1, ml: 1 }}>
                    {isEdit ? (
                        <TextField
                            value={roomName}
                            variant="standard"
                            onChange={(event) =>
                                setRoomName(event.target.value)
                            }
                            autoFocus
                            sx={{
                                '& .MuiInput-root': {
                                    fontSize: '1.375rem',
                                    fontWeight: 700,
                                },
                            }}
                        />
                    ) : (
                        <Typography variant="h4" sx={{ fontWeight: 700 }}>
                            {roomName}
                        </Typography>
                    )}
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {isEdit ? (
                        <Tooltip title="Save">
                            <IconButton onClick={save} color="primary">
                                <SaveIcon />
                            </IconButton>
                        </Tooltip>
                    ) : (
                        <>
                            <Tooltip title="Edit">
                                <IconButton onClick={() => setIsEdit(true)}>
                                    <EditIcon />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete">
                                <IconButton
                                    onClick={onDelete}
                                    sx={{
                                        color: 'error.main',
                                    }}
                                >
                                    <DeleteIcon />
                                </IconButton>
                            </Tooltip>
                        </>
                    )}
                </Box>
            </Box>

            <DevicesList devices={devices ?? []} />
        </>
    );
};
