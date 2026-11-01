import { Box, Link, MenuItem, Paper, Select, Typography } from '@mui/material';
import React, { useCallback, useEffect, useState } from 'react';
import { EchoSettings } from '../components/EchoSettings';
import { api } from '../api/charlie';
import { EchoChangelogs } from '../components/EchoChangelogs';
import { EchoScreenSetting } from '../components/EchoScreenSetting';
import { EchoDeviceInfo } from '../components/EchoDeviceInfo';

export const EchoPage = () => {
    const [selectedEcho, setSelectedEcho] = useState('');
    const [echos, setEchos] = useState([]);
    const [changelogs, setChangelogs] = useState([]);

    const loadEchos = useCallback(
        () => api(`echo?${Date.now()}`).then((res) => setEchos(res ?? [])),
        [setEchos]
    );

    useEffect(() => {
        loadEchos();
    }, [loadEchos]);

    useEffect(() => {
        api(`echo/changelogs`).then((res) => setChangelogs(res));
    }, []);

    const selected = echos.find((echo) => echo.id === selectedEcho);

    return (
        <Box>
            <Box>
                To flash your echo device please visit :{' '}
                <Link
                    href="https://quentinv.github.io/charlie-echos/"
                    target="_blank"
                >
                    Charlie echo webflasher
                </Link>
            </Box>
            {!!echos?.length && (
                <Box sx={{ mt: '1rem' }}>
                    <Select
                        labelId="device-select-label"
                        value={selectedEcho}
                        label="Select Echo Device"
                        onChange={(e) => setSelectedEcho(e.target.value)}
                    >
                        {echos.map((echo) => (
                            <MenuItem key={echo.id} value={echo.id}>
                                {echo.deviceType ? `${echo.deviceType} — ` : ''}
                                {echo.ip}
                                {echo.mac ? ` (${echo.mac})` : ''}
                            </MenuItem>
                        ))}
                    </Select>
                </Box>
            )}
            {!!selected && (
                <Paper elevation={3} sx={{ p: 3 }}>
                    <EchoDeviceInfo echo={selected} onReload={loadEchos} />
                    <EchoSettings echo={selected} />
                    <EchoScreenSetting id={selected.id} />
                </Paper>
            )}
            {!!changelogs?.length && (
                <Paper elevation={3} sx={{ p: 3, mt: 2 }}>
                    <Box>
                        <Typography variant="h6">Available versions</Typography>
                        <Box sx={{ overflow: 'auto', maxHeight: '300px' }}>
                            <EchoChangelogs data={changelogs} />
                        </Box>
                    </Box>
                </Paper>
            )}
        </Box>
    );
};
