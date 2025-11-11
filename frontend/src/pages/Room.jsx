import React, { useEffect, useState } from 'react';
import { api } from '../api/charlie';
import { useNavigate, useParams } from 'react-router-dom';
import { DevicesList } from '../components/Devices';
import { Box, CircularProgress, IconButton, TextField } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';

export const RoomPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [devices, setDevices] = useState(null);
    const [room, setRoom] = useState(null);
    const [roomName, setRoomName] = useState(null);
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
        return <CircularProgress />;
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
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <h2>
                    {isEdit ? (
                        <TextField
                            value={roomName}
                            variant="standard"
                            onChange={(event) =>
                                setRoomName(event.target.value)
                            }
                        />
                    ) : (
                        roomName
                    )}
                </h2>
                <div style={{ marginLeft: 'auto' }}>
                    {isEdit ? (
                        <IconButton onClick={save}>
                            <SaveIcon />
                        </IconButton>
                    ) : (
                        <IconButton onClick={() => setIsEdit(true)}>
                            <EditIcon />
                        </IconButton>
                    )}
                    {!isEdit && (
                        <IconButton onClick={onDelete}>
                            <DeleteIcon />
                        </IconButton>
                    )}
                </div>
            </Box>

            <DevicesList devices={devices} />
        </>
    );
};
