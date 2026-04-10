import React, { useState, useEffect } from 'react';
import {
    Box,
    Stack,
    MenuItem,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Fade,
} from '@mui/material';
import { Repeat } from '@mui/icons-material';

export const CronEditor = ({ onChange, value }) => {
    const [frequency, setFrequency] = useState('daily');
    const [time, setTime] = useState('09:00');
    const [days, setDays] = useState(['1', '2', '3', '4', '5']);
    const [interval, setInterval] = useState('5');

    useEffect(() => {
        let cron = '* * * * *';
        const [hour, minute] = time.split(':');

        if (frequency === 'interval') {
            cron = `*/${interval} * * * *`;
        } else if (frequency === 'daily') {
            cron = `${minute} ${hour} * * *`;
        } else if (frequency === 'weekly') {
            cron = `${minute} ${hour} * * ${days.join(',')}`;
        }

        if (value !== cron) {
            onChange(cron);
        }
    }, [value, frequency, time, days, interval, onChange]);

    useEffect(() => {
        const parts = value.split(' ');
        const [minute, hour, _1, _2, dow] = parts;

        // Check for "Interval" (e.g., */5 * * * *)
        if (minute.includes('/') && hour === '*' && dow === '*') {
            setFrequency('interval');
            setDays(['1', '2', '3', '4', '5']);
            setInterval(minute.replace('*/', ''));
            return;
        }

        // Check for "Weekly" (Specific days assigned)
        if (dow && dow !== '*' && dow !== '?') {
            setFrequency('weekly');
            setTime(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`);
            setDays(dow.split(','));
            return;
        }

        setFrequency('daily');
        if (hour) {
            setTime(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`);
        }
        setDays(['1', '2', '3', '4', '5']);
    }, [value]);

    return (
        <>
            <ToggleButtonGroup
                value={frequency}
                exclusive
                onChange={(_, val) => val && setFrequency(val)}
                fullWidth
                sx={{ mb: 1, borderRadius: 2 }}
            >
                <ToggleButton value="interval" sx={{ borderRadius: 2 }}>
                    Repeat
                </ToggleButton>
                <ToggleButton value="daily">Daily</ToggleButton>
                <ToggleButton value="weekly" sx={{ borderRadius: 2 }}>
                    Weekly
                </ToggleButton>
            </ToggleButtonGroup>

            <Box sx={{ mb: 1, justifyItems: 'center' }}>
                {frequency === 'interval' && (
                    <Fade in={true}>
                        <Stack
                            direction="row"
                            alignItems="center"
                            spacing={2}
                            sx={{ textAlign: 'center' }}
                        >
                            <Repeat color="primary" />
                            <TextField
                                select
                                value={interval}
                                onChange={(e) => setInterval(e.target.value)}
                                variant="standard"
                                sx={{
                                    width: 80,
                                    '& .MuiInput-root': {
                                        fontSize: 18,
                                        fontWeight: 'bold',
                                    },
                                }}
                            >
                                {['5', '10', '15', '30', '60'].map((m) => (
                                    <MenuItem key={m} value={m}>
                                        {m}m
                                    </MenuItem>
                                ))}
                            </TextField>
                        </Stack>
                    </Fade>
                )}

                {(frequency === 'daily' || frequency === 'weekly') && (
                    <Fade in={true}>
                        <Box justifyItems="center">
                            <Stack
                                direction="row"
                                spacing={2}
                                mb={frequency === 'weekly' ? 2 : 0}
                            >
                                <TextField
                                    type="time"
                                    value={time}
                                    onChange={(e) => setTime(e.target.value)}
                                    variant="standard"
                                    sx={{
                                        '& .MuiInput-root': {
                                            fontSize: 18,
                                            fontWeight: 'bold',
                                        },
                                    }}
                                />
                            </Stack>

                            {frequency === 'weekly' && (
                                <Stack
                                    direction="row"
                                    spacing={0.5}
                                    justifyContent="space-between"
                                >
                                    {['D', 'L', 'M', 'Me', 'J', 'V', 'S'].map(
                                        (day, i) => {
                                            const isSelected = days.includes(
                                                i.toString()
                                            );
                                            return (
                                                <Box
                                                    key={i}
                                                    onClick={() =>
                                                        setDays((prev) =>
                                                            isSelected
                                                                ? prev.filter(
                                                                      (d) =>
                                                                          d !==
                                                                          i.toString()
                                                                  )
                                                                : [
                                                                      ...prev,
                                                                      i.toString(),
                                                                  ]
                                                        )
                                                    }
                                                    sx={{
                                                        width: 36,
                                                        height: 36,
                                                        borderRadius: '50%',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent:
                                                            'center',
                                                        cursor: 'pointer',
                                                        fontSize: 14,
                                                        fontWeight: 'bold',
                                                        transition: '0.2s',
                                                        bgcolor: isSelected
                                                            ? 'primary.main'
                                                            : 'grey.900',
                                                        color: isSelected
                                                            ? 'blue'
                                                            : 'white',
                                                        border: '1px solid',
                                                        borderColor: isSelected
                                                            ? 'primary.main'
                                                            : 'grey.300',
                                                    }}
                                                >
                                                    {day}
                                                </Box>
                                            );
                                        }
                                    )}
                                </Stack>
                            )}
                        </Box>
                    </Fade>
                )}
            </Box>
        </>
    );
};
