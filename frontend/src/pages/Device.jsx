import React, { useEffect, useState } from 'react';
import { api } from '../api/charlie';
import { useNavigate, useParams } from 'react-router-dom';
import { ViewDevice } from '../components/Devices/View';
import {
    Box,
    CircularProgress,
    IconButton,
    Typography,
    alpha,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

export const DevicePage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [device, setDevice] = useState(/** @type {any} */ (null));

    useEffect(() => {
        (async () => {
            const dev = await api(`devices/${id}`);
            setDevice(dev ?? null);
        })();
    }, [id]);

    if (!device) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

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
                    <Typography variant="h4" sx={{ fontWeight: 700 }}>
                        {device.name}
                    </Typography>
                </Box>
            </Box>

            <ViewDevice device={device} />
        </>
    );
};