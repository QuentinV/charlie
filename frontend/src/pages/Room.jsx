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
    useTheme,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

const ROOM_ICONS = ['🏠', '🛏️', '🍳', '🛁', '🪑', '🍽️', '📚', '📺', '🚪', '🌿', '🚗', '👶'];

export const RoomPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const theme = useTheme();
    const [devices, setDevices] = useState(/** @type {any[] | null} */ (null));
    const [room, setRoom] = useState(/** @type {any} */ (null));
    const [roomName, setRoomName] = useState(
        /** @type {string | null} */ (null)
    );
    const [roomIcon, setRoomIcon] = useState('🏠');
    const [isEdit, setIsEdit] = useState(false);

    useEffect(() => {
        (async () => {
            const dev = await api(`devices?roomId=${id}`);
            setDevices(dev);
            const room = await api(`rooms/${id}`);
            setRoom(room);
            setRoomName(room.name);
            setRoomIcon(room.icon ?? '🏠');
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
            body: JSON.stringify({ name: roomName, icon: roomIcon }),
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
                        <>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography sx={{ fontSize: '1.375rem' }}>
                                    {roomIcon}
                                </Typography>
                                <TextField
                                    value={roomName}
                                    variant="standard"
                                    onChange={(event) =>
                                        setRoomName(event.target.value)
                                    }
                                    autoFocus
                                    sx={{
                                        flex: 1,
                                        '& .MuiInput-root': {
                                            fontSize: '1.375rem',
                                            fontWeight: 700,
                                        },
                                    }}
                                />
                            </Box>
                            <Box
                                sx={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: 0.5,
                                    mt: 1.5,
                                }}
                            >
                                {ROOM_ICONS.map((icon) => (
                                    <Box
                                        key={icon}
                                        role="button"
                                        aria-label={`Choose icon ${icon}`}
                                        onClick={() => setRoomIcon(icon)}
                                        sx={{
                                            width: 40,
                                            height: 40,
                                            borderRadius: 1.5,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '1.5rem',
                                            cursor: 'pointer',
                                            userSelect: 'none',
                                            bgcolor:
                                                roomIcon === icon
                                                    ? alpha('#FFD700', 0.2)
                                                    : alpha(
                                                          theme.palette.primary
                                                              .main,
                                                          0.05
                                                      ),
                                            border:
                                                roomIcon === icon
                                                    ? '2px solid #FFD700'
                                                    : '2px solid transparent',
                                            '&:hover': {
                                                bgcolor: alpha(
                                                    '#FFD700',
                                                    0.15
                                                ),
                                            },
                                        }}
                                    >
                                        {icon}
                                    </Box>
                                ))}
                            </Box>
                        </>
                    ) : (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography sx={{ fontSize: '1.375rem' }}>
                                {roomIcon}
                            </Typography>
                            <Typography variant="h4" sx={{ fontWeight: 700 }}>
                                {roomName}
                            </Typography>
                        </Box>
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
