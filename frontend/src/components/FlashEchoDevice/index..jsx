import React, { useEffect, useState } from 'react';
import {
    Button,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Typography,
} from '@mui/material';
import { api } from '../../api/charlie';

export const FlashEchoDevice = () => {
    const [ips, setIps] = useState([]);
    const [selected, setSelected] = useState('');

    useEffect(() => {
        api('echo').then(setIps);
    }, [setIps]);

    return (
        <div style={{ maxWidth: 400 }}>
            <FormControl fullWidth margin="normal">
                <InputLabel id="echo-label">Echo</InputLabel>
                <Select
                    labelId="echo"
                    value={selected}
                    label="Echo"
                    onChange={(e) => setSelected(e.target.value)}
                >
                    {ips.map((ip) => (
                        <MenuItem value={ip}>{ip}</MenuItem>
                    ))}
                </Select>
            </FormControl>

            <Button
                variant="contained"
                color="primary"
                fullWidth
                onClick={() => {
                    api('echo/ota', {
                        method: 'POST',
                        body: JSON.stringify({ ip: selected }),
                    });
                }}
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
