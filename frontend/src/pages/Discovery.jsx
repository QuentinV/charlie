import React, { useState, useEffect } from 'react';
import {
    Box,
    Card,
    CardContent,
    CardActions,
    Button,
    Typography,
    Chip,
    CircularProgress,
    Alert,
    Grid,
    Paper,
} from '@mui/material';
import { api } from '../api/charlie';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import PowerIcon from '@mui/icons-material/Power';
import TvIcon from '@mui/icons-material/Tv';
import SensorsIcon from '@mui/icons-material/Sensors';
import DeviceUnknownIcon from '@mui/icons-material/DeviceUnknown';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RouterIcon from '@mui/icons-material/Router';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';

const deviceIcons = {
    light: <LightbulbIcon />,
    switch: <PowerIcon />,
    tv: <TvIcon />,
    sensor: <SensorsIcon />,
    unknown: <DeviceUnknownIcon />,
};

const getTypeColor = (type) => {
    switch (type) {
        case 'light':
            return 'success';
        case 'switch':
            return 'primary';
        case 'tv':
            return 'info';
        case 'sensor':
            return 'warning';
        default:
            return 'default';
    }
};

export const DiscoveryPage = () => {
    const [discoveredDevices, setDiscoveredDevices] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [addingDevice, setAddingDevice] = useState(null);

    const handleDiscover = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api('devices/discover');
            setDiscoveredDevices(data || []);
        } catch (e) {
            console.error(e);
            setError('Failed to discover devices');
        } finally {
            setLoading(false);
            setAddingDevice(null);
        }
    };

    const handleAddDevice = async (provider, device) => {
        setAddingDevice(device);
        try {
            let providerId;
            if (provider?._id?.startsWith('virtual-')) {
                const newProvider = await api('providers', {
                    method: 'POST',
                    body: JSON.stringify({
                        name: `${provider.codesource} - ${device.name}`,
                        type: 'direct',
                        host: device.host,
                        mac: device.mac,
                        codesource: provider.codesource,
                    }),
                });
                providerId = newProvider.uuid;
            } else {
                providerId = provider._id;
            }

            await api('devices', {
                method: 'POST',
                body: JSON.stringify({
                    name: device.name,
                    externalId: device.externalId,
                    provider: providerId,
                    type: device.type || 'unknown',
                }),
            });

            handleDiscover();
        } catch (e) {
            console.error(e);
            alert('Failed to add device');
        }
    };

    useEffect(() => {
        handleDiscover();
    }, []);

    return (
        <Box sx={{ flexGrow: 1, p: 2 }}>
            <Box
                sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    mb: 2,
                }}
            >
                <Typography variant="h4">Device Discovery</Typography>
                <Button
                    variant="contained"
                    startIcon={<RefreshIcon />}
                    onClick={handleDiscover}
                    disabled={loading}
                >
                    {loading ? (
                        <CircularProgress size={20} color="inherit" />
                    ) : (
                        'Discover Devices'
                    )}
                </Button>
            </Box>

            {error && (
                <Alert
                    severity="error"
                    sx={{ mb: 2 }}
                    onClose={() => setError(null)}
                >
                    {error}
                </Alert>
            )}

            {loading && !discoveredDevices.length && (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                </Box>
            )}

            {discoveredDevices.map((group) => (
                <Box key={group.provider._id} sx={{ mb: 3 }}>
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            mb: 1.5,
                        }}
                    >
                        <RouterIcon color="action" />
                        <Typography variant="h6" sx={{ flexGrow: 1 }}>
                            {group.provider.name}
                        </Typography>
                        {group.publicDiscovery && (
                            <Chip
                                icon={<TravelExploreIcon />}
                                label="Public Discovery"
                                size="small"
                                color="secondary"
                                variant="outlined"
                                sx={{ mr: 1 }}
                            />
                        )}
                        <Chip
                            label={group.provider.type || 'gateway'}
                            size="small"
                            color={
                                group.provider.type === 'direct'
                                    ? 'success'
                                    : group.provider.type === 'cloud'
                                      ? 'warning'
                                      : 'primary'
                            }
                        />
                    </Box>

                    {group.devices.length === 0 ? (
                        <Typography
                            color="text.secondary"
                            sx={{ ml: 1, mb: 1 }}
                        >
                            No devices found
                        </Typography>
                    ) : (
                        <Grid container spacing={2}>
                            {group.devices.map((device) => (
                                <Grid
                                    item
                                    xs={12}
                                    sm={6}
                                    md={4}
                                    lg={3}
                                    key={`${device.externalId}:${device.host}`}
                                >
                                    <Card
                                        variant="outlined"
                                        sx={{
                                            position: 'relative',
                                            opacity: device.alreadyRegistered
                                                ? 0.7
                                                : 1,
                                            '&:hover': {
                                                boxShadow:
                                                    device.alreadyRegistered
                                                        ? 0
                                                        : 2,
                                            },
                                        }}
                                    >
                                        <CardContent>
                                            <Box
                                                sx={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent:
                                                        'space-between',
                                                }}
                                            >
                                                <Box
                                                    sx={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 1,
                                                    }}
                                                >
                                                    <Box
                                                        sx={{
                                                            color:
                                                                getTypeColor(
                                                                    device.type
                                                                ) + '.main',
                                                            display: 'flex',
                                                        }}
                                                    >
                                                        {deviceIcons[
                                                            device.type
                                                        ] || (
                                                            <DeviceUnknownIcon />
                                                        )}
                                                    </Box>
                                                    <Typography
                                                        variant="subtitle1"
                                                        fontWeight="medium"
                                                    >
                                                        {device.name}
                                                    </Typography>
                                                </Box>
                                            </Box>

                                            {device.host && (
                                                <Typography
                                                    variant="body2"
                                                    color="text.secondary"
                                                >
                                                    {device.host}
                                                </Typography>
                                            )}
                                            {device.mac && (
                                                <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    display="block"
                                                >
                                                    MAC: {device.mac}
                                                </Typography>
                                            )}
                                        </CardContent>
                                        <CardActions>
                                            <Box
                                                sx={{
                                                    width: '100%',
                                                    display: 'flex',
                                                    justifyContent: 'flex-end',
                                                }}
                                            >
                                                {device.alreadyRegistered ? (
                                                    <Typography
                                                        variant="body2"
                                                        color="text.secondary"
                                                    >
                                                        Already added
                                                    </Typography>
                                                ) : (
                                                    <Button
                                                        variant="contained"
                                                        size="small"
                                                        onClick={() =>
                                                            handleAddDevice(
                                                                group.provider,
                                                                device
                                                            )
                                                        }
                                                        disabled={
                                                            addingDevice?.externalId ===
                                                                device?.externalId &&
                                                            addingDevice?.host ===
                                                                device?.host
                                                        }
                                                        loading={
                                                            addingDevice?.externalId ===
                                                                device?.externalId &&
                                                            addingDevice?.host ===
                                                                device?.host
                                                        }
                                                    >
                                                        <AddIcon />
                                                    </Button>
                                                )}
                                            </Box>
                                        </CardActions>
                                    </Card>
                                </Grid>
                            ))}
                        </Grid>
                    )}
                </Box>
            ))}

            {discoveredDevices.length === 0 && !loading && (
                <Paper sx={{ p: 4, textAlign: 'center' }}>
                    <Typography
                        variant="h6"
                        color="text.secondary"
                        gutterBottom
                    >
                        No providers configured
                    </Typography>
                    <Typography color="text.secondary" paragraph>
                        Go to the Providers page to add providers, then click
                        "Discover Devices" to find devices on your network.
                    </Typography>
                </Paper>
            )}
        </Box>
    );
};
