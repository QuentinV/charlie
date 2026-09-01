import React, { useCallback, useEffect, useState } from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { api } from '../../api/charlie';
import { RoutineListItem } from './RoutineListItem';
import { useNavigate } from 'react-router-dom';

export const RoutinesList = () => {
    const navigate = useNavigate();
    const [routines, setRoutines] = useState(/** @type {any[]} */ ([]));

    useEffect(() => {
        (async () => {
            const res = await api('routines');
            setRoutines(res);
        })();
    }, []);

    const runNow = useCallback(
        async (routine) => {
            const res = await api(`routines/${routine._id}/exec`, {
                method: 'POST',
            });
            const r = routines.find((r) => r._id === routine._id);
            if (r) {
                r.lastRun = res.lastRun;
            }
            setRoutines([...routines]);
        },
        [routines, setRoutines]
    );

    const setActive = useCallback(
        async (r) => {
            const res = await api(`routines/${r._id}/toggle`, {
                method: 'POST',
            });
            const ro = routines.find((rou) => rou._id === r._id);
            if (ro) {
                ro.active = res.active;
            }
            setRoutines([...routines]);
        },
        [routines, setRoutines]
    );

    return (
        <Box
            height="100%"
            display="flex"
            flexDirection="column"
            overflow="hidden"
        >
            <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                mb={3}
            >
                <Typography variant="h4" fontWeight={700}>
                    Routines
                </Typography>
                <Box
                    sx={{
                        px: 1.5,
                        py: 0.5,
                        borderRadius: 99,
                        bgcolor: 'rgba(255, 215, 0, 0.12)',
                        color: 'primary.main',
                        fontWeight: 700,
                        fontSize: '0.8125rem',
                    }}
                >
                    {routines.filter((r) => r.active).length} actives
                </Box>
            </Box>

            <Box
                display="flex"
                alignItems="center"
                width="100%"
                flexDirection="column"
                overflow="auto"
            >
                {routines.length === 0 ? (
                    <Paper
                        variant="outlined"
                        sx={{
                            p: 4,
                            textAlign: 'center',
                            borderRadius: 4,
                            borderStyle: 'dashed',
                        }}
                    >
                        <Typography sx={{ color: 'text.secondary' }}>
                            Aucune routines
                        </Typography>
                    </Paper>
                ) : (
                    routines.map((r) => (
                        <RoutineListItem
                            key={r._id}
                            routine={r}
                            onEdit={() => navigate(`/routine/${r._id}`)}
                            onRunNow={runNow}
                            onToggle={setActive}
                        />
                    ))
                )}
            </Box>
        </Box>
    );
};
