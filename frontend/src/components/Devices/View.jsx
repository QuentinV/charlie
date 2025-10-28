import styled from '@emotion/styled';
import { Box, Container, Paper, Stack } from '@mui/material';
import React, { useEffect, useState } from 'react';

const device = {
    name: 'Light 1',
    _id: '123',
    externalId: '244666777',
    provider: 'ikea',
    type: 'light',
};

const Item = styled(Paper)(({ theme }) => ({
    backgroundColor: '#fff',
    ...theme.typography.body2,
    padding: theme.spacing(1),
    textAlign: 'center',
    color: (theme.vars ?? theme).palette.text.secondary,
    ...theme.applyStyles('dark', {
        backgroundColor: '#1A2027',
    }),
}));

export const ViewDevice = ({ deviceId }) => {
    const [data, setData] = useState(null);

    useEffect(() => {
        setData(device);
    }, [deviceId]);

    if (!data) return null;
    const { _id, name, externalId, provider, type } = device;

    return (
        <Box>
            <Stack spacing={2}>
                <Item>{_id}</Item>
                <Item>{name}</Item>
                <Item>{type}</Item>

                <Item>{externalId}</Item>
                <Item>{provider}</Item>
            </Stack>
        </Box>
    );
};
