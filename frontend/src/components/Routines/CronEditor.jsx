import React, { useCallback } from 'react';
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

const parse = (value) => {
    const parts = (value ?? '00 09 * * *').split(' ');
    const [minute, hour, _1, _2, dow] = parts;

    if (minute.includes('/') && hour === '*' && dow === '*') {
        return {
            frequency: 'interval',
            days: ['1', '2', '3', '4', '5'],
            interval: minute.replace('*/', ''),
        };
    }

    if (dow && dow !== '*' && dow !== '?') {
        return {
            frequency: 'weekly',
            time: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`,
            days: dow.split(','),
        };
    }

    return {
        frequency: 'daily',
        time: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`,
        days: ['1', '2', '3', '4', '5'],
    };
};

export const CronEditor = ({ onChange, value }) => {
    const { frequency, days, interval, time } = parse(value);

    const change = useCallback(
        ({ t, f, i, d }) => {
            let cron = '* * * * *';
            const freq = f ?? frequency;
            const int = i ?? interval ?? '5';
            const da = d ?? days;
            const [hour, minute] = (t ?? time ?? '09:00').split(':');
            console.log(freq, int, da, hour, minute);

            if (freq === 'interval') {
                cron = `*/${int} * * * *`;
            } else if (freq === 'daily') {
                cron = `${minute} ${hour} * * *`;
            } else if (freq === 'weekly') {
                cron = `${minute} ${hour} * * ${da.join(',')}`;
            }

            if (value !== cron) {
                onChange(cron);
            }
        },
        [frequency, interval, days, time, onChange, value]
    );

    return (
        <>
            <ToggleButtonGroup
                value={frequency}
                exclusive
                onChange={(_, val) => val && change({ f: val })}
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
                                onChange={(e) => change({ i: e.target.value })}
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
                                    onChange={(e) =>
                                        change({ t: e.target.value })
                                    }
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
                                                        change({
                                                            d: isSelected
                                                                ? days.filter(
                                                                      (d) =>
                                                                          d !==
                                                                          i.toString()
                                                                  )
                                                                : [
                                                                      ...days,
                                                                      i.toString(),
                                                                  ],
                                                        })
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
