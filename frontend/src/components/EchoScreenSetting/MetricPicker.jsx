import React, { useMemo, useState } from 'react';
import { Autocomplete, Box, Button, Stack, TextField, Typography } from '@mui/material';
import AddLinkIcon from '@mui/icons-material/AddLink';
import { fetchDeviceCapabilities } from '../../hooks/useDeviceCapabilities';
import { buildPlaceholder } from './screenUtils';

/** Readings every device publishes or that users nearly always want. */
const COMMON_PATHS = [
    'state.level',
    'state.power',
    'state.properties.condition',
];

/**
 * Pick a device reading and insert it into the current text.
 *
 * The device list comes from the API (`devices`), the property paths from the
 * device's own capability schema when the provider publishes one — no per-brand
 * vocabulary, exactly like the rest of Charlie.
 *
 * @param {object} props
 * @param {{ _id: string, name?: string }[]} props.devices
 * @param {(placeholder: string) => void} props.onInsert
 */
export const MetricPicker = ({ devices = [], onInsert }) => {
    const [deviceName, setDeviceName] = useState('');
    const [path, setPath] = useState('');
    const [paths, setPaths] = useState([]);
    const [loading, setLoading] = useState(false);

    const deviceOptions = useMemo(
        () => devices.map((device) => device.name).filter(Boolean),
        [devices]
    );

    const handleDeviceChange = async (_event, value) => {
        setDeviceName(value ?? '');
        const device = devices.find((candidate) => candidate.name === value);
        if (!device) {
            setPaths([]);
            return;
        }

        setLoading(true);
        try {
            const capabilities = await fetchDeviceCapabilities(device._id);
            const keys = (capabilities?.state ?? [])
                .map((property) => property.key ?? property.name)
                .filter(Boolean);
            setPaths([...new Set([...keys, ...COMMON_PATHS])]);
        } finally {
            setLoading(false);
        }
    };

    const canInsert = !!deviceName && !!path;

    return (
        <Stack spacing={1}>
            <Typography variant="caption" color="text.secondary">
                Insert a device reading — it is resolved on the device at refresh
                time, never sent as a fixed value.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Autocomplete
                    size="small"
                    sx={{ minWidth: 180, flex: 1 }}
                    options={deviceOptions}
                    value={deviceName || null}
                    onChange={handleDeviceChange}
                    renderInput={(params) => (
                        <TextField {...params} label="Device" />
                    )}
                />
                <Autocomplete
                    size="small"
                    freeSolo
                    sx={{ minWidth: 180, flex: 1 }}
                    loading={loading}
                    options={paths.length ? paths : COMMON_PATHS}
                    value={path}
                    onInputChange={(_event, value) => setPath(value ?? '')}
                    renderInput={(params) => (
                        <TextField
                            {...params}
                            label="Property path"
                            helperText="e.g. level, state.temperature, state.properties.condition"
                        />
                    )}
                />
            </Box>
            <Button
                size="small"
                variant="outlined"
                startIcon={<AddLinkIcon />}
                disabled={!canInsert}
                onClick={() => onInsert(buildPlaceholder(deviceName, path))}
                sx={{ alignSelf: 'flex-start' }}
            >
                Insert reading
            </Button>
        </Stack>
    );
};

export default MetricPicker;
