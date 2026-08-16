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
    compact = false,
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
        <Typography
            variant={compact ? 'caption' : 'body2'}
            sx={{
                color: power === 'on' ? 'primary.main' : 'error.main',
                fontWeight: 600,
            }}
        >
            {level ?? power}
        </Typography>
    );

    const render = () => {
        if (type === DeviceType.sensor) {
            return (
                <Box sx={{ marginRight: compact ? '12px' : '20px' }}>
                    {renderLevel()}
                </Box>
            );
        }

        if (type === DeviceType.button) {
            return (
                <Button
                    endIcon={<ToggleOffIcon />}
                    size="small"
                    variant="contained"
                    onClick={toggleState}
                    loading={loading}
                    sx={{
                        px: compact ? 1.5 : 2,
                        py: compact ? 0.5 : 1,
                    }}
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
                    size={compact ? 'small' : 'medium'}
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
