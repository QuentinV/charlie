import { Box, Button, Switch, Typography } from '@mui/material';
import React, { useState } from 'react';
import { api } from '../../api/charlie';
import { DeviceType } from './constants';
import ToggleOffIcon from '@mui/icons-material/ToggleOff';

export const DeviceToggle = ({
    deviceId,
    type,
    power,
    level,
    onStateChange,
}) => {
    const [loading, setLoading] = useState(false);

    const toggleState = async () => {
        setLoading(true);
        const res = await api(`devices/${deviceId}/state/toggle`, {
            method: 'PUT',
        });

        if (res) {
            onStateChange(res?.state);
        }
        setLoading(false);
    };

    const renderLevel = () => (
        <Typography sx={{ color: power === 'on' ? 'yellow' : 'red' }}>
            {level ?? power}
        </Typography>
    );

    const render = () => {
        if (type === DeviceType.sensor) {
            return <Box sx={{ marginRight: '20px' }}>{renderLevel()}</Box>;
        }

        if (type === DeviceType.button) {
            return (
                <Button
                    endIcon={<ToggleOffIcon />}
                    size="small"
                    variant="contained"
                    onClick={toggleState}
                    loading={loading}
                >
                    Toggle
                </Button>
            );
        }

        return (
            <>
                {level !== undefined && renderLevel()}
                <Switch
                    checked={power === 'on'}
                    onChange={toggleState}
                    color="primary"
                    disabled={loading}
                />
            </>
        );
    };

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'end',
            }}
        >
            {render()}
        </Box>
    );
};
