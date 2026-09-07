import React, { useEffect, useState } from 'react';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import { api } from '../../api/charlie';
import GenericControls from './GenericControls';
import { ACControls } from './providers/clim';
import { TVControls } from './providers/sony_bravia_tv';
import { TYPE_CONTROLS } from './types';

/**
 * Registry of hand-authored provider-specific renderers, keyed by
 * `(deviceType)/(providerCode)`. Providers without an entry fall back to the
 * per-type default control (`TYPE_CONTROLS`), then to the generic
 * `capabilities.state[]` renderer. Each provider module is kept
 * self-contained so it can later be externalised (schema + renderer together).
 */
const CUSTOM_CONTROLS = {
    'thermostat/clim': ACControls,
    'tv/sony_bravia_tv': TVControls,
};

/**
 * Resolution order: provider override → type default → generic renderer.
 */
const resolveControl = (type, codesource) =>
    CUSTOM_CONTROLS[`${type}/${codesource}`] ??
    TYPE_CONTROLS[type] ??
    null;

/**
 * Whether a hand-authored provider-specific control exists for the given
 * `(deviceType, providerCode)` couple. Used by parent layouts to decide
 * whether the controls section should be promoted ahead of general config.
 */
export const hasCustomControl = (type, codesource) =>
    !!CUSTOM_CONTROLS[`${type}/${codesource}`];

export const DeviceControls = ({
    device,
    codesource,
    capabilities,
    onStateChange,
    state,
    loading = false,
}) => {
    if (!device?._id) return null;

    const fullDevice = { ...device, state };
    const Custom = resolveControl(device?.type, codesource);
    if (Custom) {
        // Hand-authored renderers expect a fully-loaded state to paint their
        // dashboard. Show a centered spinner until the fresh state arrives.
        if (loading) {
            return (
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        minHeight: 160,
                    }}
                >
                    <CircularProgress />
                </Box>
            );
        }
        return <Custom device={fullDevice} onStateChange={onStateChange} />;
    }

    return (
        <GenericControls
            device={fullDevice}
            schema={capabilities?.state ?? []}
            onStateChange={onStateChange}
        />
    );
};

/**
 * Detail-view wrapper: fetches the device capabilities once, then renders the
 * resolved control panel (provider-specific custom → per-type default →
 * generic capability renderer).
 */
export const DeviceDetailControls = ({
    device,
    codesource,
    onStateChange,
    capabilities: capabilitiesProp,
    state,
    loading = false,
}) => {
    const [fetchedCapabilities, setFetchedCapabilities] = useState(null);
    const capabilities = capabilitiesProp ?? fetchedCapabilities;

    useEffect(() => {
        if (capabilitiesProp || !device?._id) return;
        api(`devices/${device._id}/capabilities`)
            .then(setFetchedCapabilities)
            .catch(() => setFetchedCapabilities(null));
    }, [device?._id, capabilitiesProp]);

    return (
        <Stack spacing={2} sx={{ p: 1 }}>
            <DeviceControls
                device={device}
                codesource={codesource}
                capabilities={capabilities}
                onStateChange={onStateChange}
                state={state}
                loading={loading}
            />
            {!capabilities && (
                <Typography variant="body2" color="text.secondary">
                    Aucune capacité déclarée pour cet appareil.
                </Typography>
            )}
        </Stack>
    );
};

export default DeviceControls;