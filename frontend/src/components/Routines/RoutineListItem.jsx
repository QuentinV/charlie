import React from 'react';
import {
    Box,
    Typography,
    Paper,
    Stack,
    Switch,
    IconButton,
    Chip,
} from '@mui/material';
import { PlayArrow } from '@mui/icons-material';

export const RoutineListItem = ({ routine, onToggle, onEdit, onRunNow }) => {
    return (
        <Paper
            elevation={0}
            sx={{
                p: 2,
                mb: 2,
                borderRadius: 4,
                border: '1px solid',
                borderColor: routine.active ? 'primary.200' : 'grey.200',
                transition: 'all 0.2s ease',
                '&:active': { transform: 'scale(0.98)' },
            }}
        >
            <Box
                display="flex"
                justifyContent="space-between"
                alignItems="flex-start"
            >
                <Stack
                    spacing={0.5}
                    sx={{ flex: 1, cursor: 'pointer' }}
                    onClick={() => onEdit(routine)}
                >
                    <Typography
                        variant="h6"
                        sx={{
                            fontWeight: 700,
                            color: routine.active
                                ? 'text.primary'
                                : 'text.disabled',
                            fontSize: '1.1rem',
                        }}
                    >
                        {routine.name}
                    </Typography>
                </Stack>

                <Switch
                    checked={routine.active}
                    onChange={(e) => onToggle(routine, e.target.checked)}
                    color="primary"
                />
            </Box>

            <Box
                sx={{
                    mt: 2,
                    pt: 2,
                    borderTop: '1px solid',
                    borderColor: 'grey.100',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}
            >
                <Box>
                    {routine.lastRun ? (
                        <Typography
                            variant="caption"
                            sx={{ color: 'text.disabled' }}
                        >
                            Last run:{' '}
                            {new Date(routine.lastRun).toLocaleTimeString([], {
                                day: '2-digit',
                                month: '2-digit',
                                year: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                            })}
                        </Typography>
                    ) : (
                        <Chip
                            label="Never run"
                            size="small"
                            variant="outlined"
                            sx={{ height: 20, fontSize: 10 }}
                        />
                    )}
                </Box>

                <Stack direction="row" spacing={1}>
                    <IconButton
                        size="small"
                        onClick={() => onRunNow(routine)}
                        sx={{ bgcolor: 'primary.50', color: 'primary.main' }}
                    >
                        <PlayArrow fontSize="small" />
                    </IconButton>
                </Stack>
            </Box>
        </Paper>
    );
};
