import React, { useEffect, useState } from 'react';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import { api } from '../../api/charlie';
import GenericControls from './GenericControls';
import FunctionControls from './FunctionControls';
import { ACControls } from './providers/clim';
import { TVControls } from './providers/sony_bravia_tv';

/**
 * Registry of hand-authored provider-specific renderers, keyed by
 * `(deviceType)/(providerCode)`. Providers without an entry fall back to the
 * generic `capabilities.state[]` renderer. Each provider module is kept
 * self-contained so it can later be externalised (schema + renderer together).
 */
const CUSTOM_CONTROLS = {
    'thermostat/clim': ACControls,
    'tv/sony_bravia_tv': TVControls,
};

const resolveControl = (type, codesource) =>
    CUSTOM_CONTROLS[`${type}/${codesource}`] ?? null;

/**
 * Whether a hand-authored custom control exists for the given
 * `(deviceType, providerCode)` couple. Used by parent layouts to decide
 * whether the controls section should be promoted ahead of general config.
 */
export const hasCustomControl = (type, codesource) =>
    !!resolveControl(type, codesource);

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
 * resolved control panel plus the "Fonctions" (typed functions) section.
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

    const Custom = resolveControl(device?.type, codesource);
    const showFunctions =
        !(Custom?.HIDES_FUNCTIONS ?? false) &&
        (capabilities?.functions?.length ?? 0) > 0;

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
            {showFunctions && (
                <FunctionControls
                    device={device}
                    functions={capabilities?.functions ?? []}
                />
            )}
            {!capabilities && (
                <Typography variant="body2" color="text.secondary">
                    Aucune capacité déclarée pour cet appareil.
                </Typography>
            )}
        </Stack>
    );
};

export default DeviceControls;