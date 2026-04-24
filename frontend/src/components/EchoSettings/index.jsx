import React, { useEffect, useState } from 'react';
import {
    Box,
    TextField,
    Button,
    Typography,
    Paper,
    Stack,
    Slider,
} from '@mui/material';
import { api } from '../../api/charlie';

export const EchoSettings = ({ ip }) => {
    const [settings, setSettings] = useState(null);

    useEffect(() => {
        api(`echo/${ip.replaceAll('.', '-')}/params`).then((res) =>
            setSettings(
                res ?? {
                    serverIp: '192.168.1.1',
                    wakeWordAccuracy: 0.85,
                }
            )
        );
    }, [setSettings, ip]);

    const handleInputChange = (e) => {
        setSettings({
            ...(settings ?? {}),
            [e.target.name]: e.target.value,
        });
    };

    const handleSliderChange = (event, newValue) => {
        setSettings({
            ...(settings ?? {}),
            wakeWordAccuracy: newValue / 100,
        });
    };

    const handleSave = () => {
        api(`echo/${ip.replaceAll('.', '-')}/params`, {
            method: 'POST',
            body: JSON.stringify(settings),
        });
    };

    if (!settings) return null;

    return (
        <Paper elevation={3} sx={{ p: 4, maxWidth: 400, mx: 'auto', mt: 4 }}>
            <Stack spacing={4} sx={{ mt: 2 }}>
                <TextField
                    label="Server ip"
                    name="serverIp"
                    value={settings.serverIp}
                    onChange={handleInputChange}
                    fullWidth
                    variant="outlined"
                />

                <Box>
                    <Typography
                        gutterBottom
                        color="text.secondary"
                        sx={{ margin: 0 }}
                    >
                        Wake word accuracy: {settings.wakeWordAccuracy * 100}%
                    </Typography>
                    <Slider
                        value={settings.wakeWordAccuracy * 100}
                        onChange={handleSliderChange}
                        valueLabelDisplay="auto"
                        step={1}
                        min={0}
                        max={100}
                        marks={[
                            { value: 0, label: '0%' },
                            { value: 100, label: '100%' },
                        ]}
                        sx={{ margin: 0 }}
                    />
                </Box>

                <Button variant="contained" size="medium" onClick={handleSave}>
                    Save
                </Button>
            </Stack>
        </Paper>
    );
};
