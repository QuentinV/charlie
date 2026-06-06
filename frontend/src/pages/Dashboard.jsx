import React, { useEffect, useState } from 'react';
import {
    Box,
    Button,
    Card,
    CardContent,
    CardHeader,
    CircularProgress,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Switch,
    TextField,
    Typography,
    Stack,
    Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import { api } from '../api/charlie';
import HistoricalDeviceChart from '../components/DeviceStateChart';

const STORAGE_KEY = 'charlie.dashboard.histories';

/**
 * @typedef {{ id: string; deviceId: string; title: string; showLevel: boolean; showPower: boolean }} DashboardWidget
 */

const createWidget = () => ({
    id:
        typeof window !== 'undefined' && window.crypto?.randomUUID
            ? window.crypto.randomUUID()
            : `widget-${Date.now()}`,
    deviceId: '',
    title: '',
    showLevel: true,
    showPower: true,
});

const loadWidgets = () => {
    if (typeof window === 'undefined') return [];

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed.map((item) => {
            const { rangeDays, ...savedWidget } = item;
            return {
                ...createWidget(),
                ...savedWidget,
            };
        });
    } catch (error) {
        return [];
    }
};

/** @param {DashboardWidget[]} widgets */
const saveWidgets = (widgets) => {
    if (typeof window === 'undefined') return;
    try {
        const payload = widgets.map(({ rangeDays, ...widget }) => widget);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
        console.warn('Unable to save dashboard configuration', error);
    }
};

/**
 * @param {{ widget: DashboardWidget; devices: Array<{ _id: string; name: string }>; onUpdate: (widgetId: string, changes: any) => void; onRemove: (widgetId: string) => void; }} props
 */
function DeviceHistoryCard({ widget, devices, onUpdate, onRemove }) {
    const device = devices.find((item) => item._id === widget.deviceId);
    const [editing, setEditing] = useState(!widget.deviceId);

    return (
        <Card
            sx={{
                display: 'flex',
                flexDirection: 'column',
                minHeight: editing ? 500 : 340,
            }}
        >
            <CardHeader
                title={widget.title || device?.name || 'Untitled chart'}
                subheader={
                    device ? `Device: ${device.name}` : 'Pick a device to start'
                }
                action={
                    <Stack direction="row" spacing={1}>
                        <Tooltip title={editing ? 'Save chart' : 'Edit chart'}>
                            <IconButton
                                onClick={() => setEditing((prev) => !prev)}
                                size="small"
                            >
                                {editing ? <CheckIcon /> : <EditIcon />}
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="Remove chart">
                            <IconButton onClick={() => onRemove(widget.id)}>
                                <DeleteIcon />
                            </IconButton>
                        </Tooltip>
                    </Stack>
                }
            />
            <CardContent
                sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}
            >
                {editing && (
                    <Box
                        sx={{
                            display: 'grid',
                            gap: 2,
                            gridTemplateColumns: {
                                xs: '1fr',
                                sm: '1fr 1fr',
                            },
                            mb: 2,
                        }}
                    >
                        <Box>
                            <TextField
                                label="Chart title"
                                value={widget.title}
                                onChange={(event) =>
                                    onUpdate(widget.id, {
                                        title: event.target.value,
                                    })
                                }
                                fullWidth
                            />
                        </Box>
                        <Box sx={{ width: '100%' }}>
                            <FormControl fullWidth>
                                <InputLabel
                                    id={`dashboard-device-label-${widget.id}`}
                                >
                                    Device
                                </InputLabel>
                                <Select
                                    labelId={`dashboard-device-label-${widget.id}`}
                                    value={widget.deviceId}
                                    label="Device"
                                    onChange={(event) =>
                                        onUpdate(widget.id, {
                                            deviceId: event.target.value,
                                        })
                                    }
                                >
                                    <MenuItem value="">None</MenuItem>
                                    {devices.map((item) => (
                                        <MenuItem
                                            key={item._id}
                                            value={item._id}
                                        >
                                            {item.name}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Box>
                        <Box>
                            <Stack
                                direction="row"
                                alignItems="center"
                                spacing={1}
                            >
                                <Typography>Level</Typography>
                                <Switch
                                    checked={widget.showLevel}
                                    onChange={(event) =>
                                        onUpdate(widget.id, {
                                            showLevel: event.target.checked,
                                        })
                                    }
                                />
                                <Typography>Power</Typography>
                                <Switch
                                    checked={widget.showPower}
                                    onChange={(event) =>
                                        onUpdate(widget.id, {
                                            showPower: event.target.checked,
                                        })
                                    }
                                />
                            </Stack>
                        </Box>
                    </Box>
                )}
                <Box
                    sx={{
                        flexGrow: 1,
                        minHeight: 280,
                        position: 'relative',
                        borderRadius: 1,
                        overflow: 'hidden',
                        bgcolor: 'background.paper',
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                    }}
                >
                    <HistoricalDeviceChart
                        deviceId={widget.deviceId}
                        title={widget.title || device?.name || 'Device history'}
                        showLevel={widget.showLevel}
                        showPower={widget.showPower}
                        hideToolbar={!editing}
                        height={editing ? 280 : 240}
                    />
                </Box>
            </CardContent>
        </Card>
    );
}

export const DashboardPage = () => {
    const [devices, setDevices] = useState(
        /** @type {Array<{ _id: string; name: string }>} */ ([])
    );
    const [widgets, setWidgets] = useState(
        /** @type {DashboardWidget[]} */ (loadWidgets())
    );
    const [loadingDevices, setLoadingDevices] = useState(true);

    useEffect(() => {
        api('devices')
            .then((res) => {
                setDevices(res ?? []);
            })
            .catch(() => {
                setDevices([]);
            })
            .finally(() => {
                setLoadingDevices(false);
            });
    }, []);

    useEffect(() => {
        saveWidgets(widgets);
    }, [widgets]);

    const handleAddWidget = () => {
        setWidgets((current) => [...current, createWidget()]);
    };

    /** @type {(widgetId: string) => void} */
    const handleRemoveWidget = (widgetId) => {
        setWidgets((current) =>
            current.filter((widget) => widget.id !== widgetId)
        );
    };

    /** @type {(widgetId: string, changes: Partial<DashboardWidget>) => void} */
    const handleUpdateWidget = (widgetId, changes) => {
        setWidgets((current) =>
            current.map((widget) =>
                widget.id === widgetId ? { ...widget, ...changes } : widget
            )
        );
    };

    const handleReset = () => {
        setWidgets([]);
        saveWidgets([]);
    };

    return (
        <Box sx={{ width: '100%' }}>
            <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'stretch', sm: 'center' }}
                spacing={2}
                mb={2}
            >
                <Stack spacing={1}>
                    <Typography variant="h4">Dashboard</Typography>
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={handleAddWidget}
                    >
                        Add chart
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<RefreshIcon />}
                        onClick={handleReset}
                    >
                        Reset
                    </Button>
                </Stack>
            </Stack>

            {loadingDevices ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                </Box>
            ) : widgets.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                    <Typography variant="h6" gutterBottom>
                        No charts yet
                    </Typography>
                    <Typography color="text.secondary">
                        Click Add chart to create your first device history
                        view.
                    </Typography>
                </Box>
            ) : (
                <Box
                    sx={{
                        display: 'grid',
                        gap: 2,
                        gridTemplateColumns: {
                            xs: '1fr',
                            sm: 'repeat(2, minmax(0, 1fr))',
                            md: 'repeat(3, minmax(0, 1fr))',
                        },
                    }}
                >
                    {widgets.map((widget) => (
                        <Box key={widget.id}>
                            <DeviceHistoryCard
                                widget={widget}
                                devices={devices}
                                onUpdate={handleUpdateWidget}
                                onRemove={handleRemoveWidget}
                            />
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );
};
