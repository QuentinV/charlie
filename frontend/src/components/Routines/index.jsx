import React, { useEffect, useState } from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { api } from '../../api/charlie';
import { RoutineListItem } from './RoutineListItem';

export const RoutinesList = () => {
    const [routines, setRoutines] = useState([]);

    useEffect(() => {
        (async () => {
            const res = await api('routines');
            setRoutines(res);
        })();
    }, []);

    return (
        <Box sx={{ p: 2, maxWidth: 500, mx: 'auto' }}>
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
                        key={r.id}
                        routine={r}
                        onEdit={() => {}}
                        onRunNow={() => {}}
                        onToggle={() => {}}
                    />
                ))
            )}
        </Box>
    );
};
