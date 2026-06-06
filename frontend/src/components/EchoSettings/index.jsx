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

    const runOta = () => {
        api(`echo/ota`, { method: 'POST', body: JSON.stringify({ ip }) });
    };

    if (!settings) return null;

    return (
        <Box
            sx={{
                gap: 1,
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
            }}
        >
            <Button size="medium" onClick={runOta} sx={{ mt: 2 }}>
                Run OTA - Auto update to latest version
                <br />
                Echo led should be Cyan{' '}
            </Button>
            <Paper elevation={1} sx={{ p: 3, my: 2 }}>
                <Stack spacing={4}>
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
                            Wake word accuracy:{' '}
                            {settings.wakeWordAccuracy * 100}%
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

                    <Button
                        variant="contained"
                        size="medium"
                        onClick={handleSave}
                    >
                        Save
                    </Button>
                </Stack>
            </Paper>
        </Box>
    );
};
