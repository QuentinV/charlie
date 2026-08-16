import React, { useEffect, useState } from 'react';
import { Box, Grid, useMediaQuery, useTheme } from '@mui/material';
import FullScreenDialog from '../FullScreenDialog';
import { ViewDevice } from './View';
import { DeviceCard } from './Card';

/**
 * @param {{
 *   devices: any[];
 *   favoriteDeviceIds?: string[];
 *   onToggleFavorite?: (device: any) => void;
 * }} props
 */
export const DevicesList = ({
    devices,
    favoriteDeviceIds = [],
    onToggleFavorite,
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const [selected, setSelected] = useState(/** @type {any} */ (null));
    const [devicesState, setDevicesState] = useState(devices ?? []);

    useEffect(() => {
        setDevicesState(devices ?? []);
    }, [devices]);

    /**
     * @param {any} device
     */
    const handleStateChange = (device) => {
        setDevicesState((prev) =>
            prev.map((d) => (d._id === device._id ? device : d))
        );
    };

    return (
        <>
            <Grid
                container
                spacing={isMobile ? 1 : { sm: 1.5, md: 2 }}
                sx={{ width: '100%', m: 0, mt: 0 }}
            >
                {devicesState.map((device) => (
                    <Grid
                        key={device?._id ?? device?.name}
                        size={isMobile ? { xs: 6 } : { sm: 6, md: 4, lg: 3 }}
                        sx={{ pt: '0 !important', mt: 0 }}
                    >
                        <DeviceCard
                            device={device}
                            compact={isMobile}
                            favorite={favoriteDeviceIds.includes(device?._id)}
                            onToggleFavorite={onToggleFavorite}
                            onSelect={(d) => {
                                handleStateChange(d);
                                setSelected(d);
                            }}
                        />
                    </Grid>
                ))}
            </Grid>
            {!!selected && (
                <FullScreenDialog
                    open={!!selected}
                    handleClose={() => setSelected(null)}
                    title={selected?.name ?? 'Devices'}
                >
                    <Box sx={{ p: 2 }}>
                        <ViewDevice deviceId={selected._id} />
                    </Box>
                </FullScreenDialog>
            )}
        </>
    );
};
