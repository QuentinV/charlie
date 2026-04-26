import { Box, Link, MenuItem, Select, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { EchoSettings } from '../components/EchoSettings';
import { api } from '../api/charlie';
import { EchoChangelogs } from '../components/EchoChangelogs';

export const EchoPage = () => {
    const [selectedEcho, setSelectedEcho] = useState('');
    const [echos, setEchos] = useState([]);
    const [changelogs, setChangelogs] = useState([]);

    useEffect(() => {
        api(`echo?${Date.now()}`).then((res) => setEchos(res));
    }, [setEchos]);

    useEffect(() => {
        api(`echo/changelogs`).then((res) => setChangelogs(res));
    }, []);

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
                        {echos.map((ip) => (
                            <MenuItem key={ip} value={ip}>
                                {ip}
                            </MenuItem>
                        ))}
                    </Select>
                </Box>
            )}
            {!!selectedEcho && <EchoSettings ip={selectedEcho} />}
            {!!changelogs?.length && (
                <Box>
                    <Typography variant="h6" sx={{ marginTop: 2 }}>
                        Available versions
                    </Typography>
                    <Box sx={{ overflow: 'auto', maxHeight: '300px' }}>
                        <EchoChangelogs data={changelogs} />
                    </Box>
                </Box>
            )}
        </Box>
    );
};
