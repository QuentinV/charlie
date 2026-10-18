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
    unit,
    onStateChange,
    compact = false,
    disabled = false,
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

    // `level` is the device's canonical numeric value (see the backend's
    // `LEVEL_SOURCES`): a percentage for most domains, the ambient temperature
    // for a thermostat — whose schema unit is °C.
    const levelUnit = type === DeviceType.thermostat ? '°C' : (unit ?? '');

    // A reading (a sensor measurement, a thermostat's ambient temperature) has
    // no on/off colour: red would read as a fault.
    const levelColor =
        type === DeviceType.sensor || type === DeviceType.thermostat
            ? 'text.primary'
            : power === 'on'
              ? 'primary.main'
              : 'error.main';

    const renderLevel = () => (
        <Typography
            variant={compact ? 'caption' : 'body2'}
            sx={{
                color: levelColor,
                fontWeight: 600,
            }}
        >
            {level != null ? `${level} ${levelUnit}`.trim() : power}
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
                    loading={loading || disabled}
                    disabled={disabled}
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
                    disabled={loading || disabled}
                    size={compact ? 'small' : 'medium'}
                />
            </>
        );
    };

    return (
        <Box
            onClick={(e) => e.stopPropagation()}
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
