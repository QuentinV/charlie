import React, { useState } from 'react';
import {
    Button,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Typography,
} from '@mui/material';
import { ESPLoader } from 'esptool-js';

export const FlashEchoDevice = () => {
    const [echoType, setEchoType] = useState('echo-main');
    const [status, setStatus] = useState('');

    const handleFlash = async () => {
        try {
            setStatus('Requesting serial port...');
            if (!('serial' in navigator)) {
                setStatus('WebSerial is not supported in this browser.');
                return;
            }
            const port = await navigator.serial.requestPort();
            await port.open({ baudRate: 115200 });

            setStatus('Connecting to ESP32...');
            const esploader = new ESPLoader(port, 115200);
            await esploader.connect();

            const firmwareUrl = `/api/echo/${echoType}/latest/firmware.bin`;
            setStatus(`Downloading firmware from ${firmwareUrl}...`);

            const firmware = await fetch(firmwareUrl).then((r) =>
                r.arrayBuffer()
            );

            setStatus('Flashing firmware...');
            await esploader.flash([
                { data: new Uint8Array(firmware), address: 0x10000 },
            ]);

            setStatus('Resetting device...');
            await esploader.reset();

            setStatus('Flash complete!');
        } catch (err) {
            console.error(err);
            setStatus('Error: ' + err.message);
        }
    };

    return (
        <div style={{ maxWidth: 400 }}>
            <FormControl fullWidth margin="normal">
                <InputLabel id="echo-type-label">Echo version/type</InputLabel>
                <Select
                    labelId="echo-type-label"
                    value={echoType}
                    label="Echo Type"
                    onChange={(e) => setEchoType(e.target.value)}
                >
                    <MenuItem value="echo-main">main</MenuItem>
                    <MenuItem value="echo-zero">zero</MenuItem>
                    <MenuItem value="echo-zero-bis">zero bis (screen)</MenuItem>
                </Select>
            </FormControl>

            <Button
                variant="contained"
                color="primary"
                fullWidth
                onClick={handleFlash}
                sx={{ mt: 2 }}
            >
                Flash my echo device
            </Button>

            <Typography variant="body2" sx={{ mt: 2 }}>
                {status}
            </Typography>
        </div>
    );
};
