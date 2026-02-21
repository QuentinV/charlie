import { Button, Switch } from '@mui/material';
import React, { useState } from 'react';
import { api } from '../../api/charlie';
import { DeviceType } from './constants';
import ToggleOffIcon from '@mui/icons-material/ToggleOff';

export const DeviceToggle = ({ deviceId, type, power, onStateChange }) => {
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

    return (
        <>
            {type === DeviceType.button ? (
                <Button
                    endIcon={<ToggleOffIcon />}
                    size="small"
                    variant="contained"
                    onClick={toggleState}
                    loading={loading}
                >
                    Toggle
                </Button>
            ) : (
                <Switch
                    checked={power === 'on'}
                    onChange={toggleState}
                    color="primary"
                    disabled={loading}
                />
            )}
        </>
    );
};
