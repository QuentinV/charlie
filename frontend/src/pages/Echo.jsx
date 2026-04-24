import { Box, Link, MenuItem, Select } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { EchoSettings } from '../components/EchoSettings';
import { api } from '../api/charlie';

export const EchoPage = () => {
    const [selectedEcho, setSelectedEcho] = useState('');
    const [echos, setEchos] = useState([]);

    useEffect(() => {
        api(`echo?${Date.now()}`).then((res) => setEchos(res));
    }, [setEchos]);

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
        </Box>
    );
};
