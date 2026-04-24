import React, { useCallback, useEffect, useState } from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { api } from '../../api/charlie';
import { RoutineListItem } from './RoutineListItem';
import { useNavigate } from 'react-router-dom';

export const RoutinesList = () => {
    const navigate = useNavigate();
    const [routines, setRoutines] = useState([]);

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
        async (r, checked) => {
            await api(`routines/${r._id}`, {
                method: 'PUT',
                body: JSON.stringify({ active: checked }),
            });
            const ro = routines.find((rou) => rou._id === r._id);
            if (ro) {
                ro.active = checked;
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
                <Typography variant="h5" fontWeight="900" color="black">
                    Routines
                </Typography>
                <Typography variant="body2" color="primary" fontWeight="bold">
                    {routines.filter((r) => r.active).length} actives
                </Typography>
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
                        <Typography color="textSecondary">
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
