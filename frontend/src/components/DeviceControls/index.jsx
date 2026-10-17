import React from 'react';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import { useDeviceCapabilities } from '../../hooks/useDeviceCapabilities';
import GenericControls from './GenericControls';
import { ACControls } from './providers/clim';
import { FunctionList } from './primitives/FunctionList';
import { TYPE_CONTROLS } from './types';

/**
 * Registry of hand-authored provider-specific renderers.
 *
 * The only key is the **control profile** a provider advertises
 * (`capabilities.control`, e.g. `clim` for a climate entity whatever its
 * integration). Everything else resolves by **device type** through
 * `TYPE_CONTROLS`, so support for a device is a panel per type — never a panel
 * per brand. Providers without an entry fall back to the generic
 * `capabilities.state[]` renderer, then to the generic function list.
 */
const CUSTOM_CONTROLS = {
    clim: ACControls,
};

/**
 * Panels that own their domain's commands entirely: the generic function list is
 * suppressed (not duplicated) underneath them. Keyed by control profile or
 * device type, never by brand.
 */
const FUNCTION_AWARE = new Set(['clim', 'tv', 'thermostat']);

/**
 * Commands a type panel already renders itself, so the function list never
 * duplicates a button. Keyed by device type; the list keeps everything the
 * panel does NOT cover (a cover's tilt services, for instance).
 */
const PANEL_FUNCTIONS = {
    shutter: [
        'cover.open_cover',
        'cover.close_cover',
        'cover.stop_cover',
        'cover.set_cover_position',
    ],
};

/**
 * Resolution order: advertised control profile → type default → generic
 * renderer (null).
 */
const resolveControl = (type, capabilities) =>
    CUSTOM_CONTROLS[capabilities?.control] ?? TYPE_CONTROLS[type] ?? null;

export const DeviceControls = ({
    device,
    capabilities,
    onStateChange,
    state,
    loading = false,
}) => {
    if (!device?._id) return null;

    const fullDevice = { ...device, state };
    const Custom = resolveControl(device?.type, capabilities);
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
        return (
            <Custom
                device={fullDevice}
                capabilities={capabilities}
                onStateChange={onStateChange}
            />
        );
    }

    const schema = capabilities?.state ?? [];
    const functions = capabilities?.functions ?? [];
    const functionAware =
        FUNCTION_AWARE.has(capabilities?.control) ||
        FUNCTION_AWARE.has(device?.type);

    // Everything the resolved panel does not already expose as a control.
    const handled = new Set(PANEL_FUNCTIONS[device?.type] ?? []);
    const remaining = functions.filter((fn) => !handled.has(fn.name));

    // A device whose capabilities are only functions (a lock, a vacuum…) has no
    // schema to render: the function list IS its panel.
    const showFunctions = remaining.length > 0 && !functionAware;
    const showSchema = schema.length > 0 || !showFunctions;

    return (
        <Stack spacing={2}>
            {showSchema && (
                <GenericControls
                    device={fullDevice}
                    schema={schema}
                    onStateChange={onStateChange}
                />
            )}
            {showFunctions && (
                <FunctionList device={fullDevice} functions={remaining} />
            )}
        </Stack>
    );
};

/**
 * Detail-view wrapper: resolves the device capabilities through the shared
 * cache (or accepts them as a prop), then renders the resolved control panel
 * (control profile â†’ per-type default â†’ generic capability renderer).
 */
export const DeviceDetailControls = ({
    device,
    onStateChange,
    capabilities: capabilitiesProp,
    state,
    loading = false,
}) => {
    // Capabilities either come from the parent (already loaded) or from the
    // shared, de-duplicated capabilities cache â€” so however many consumers
    // mount at once, the device is fetched a single time.
    const deviceId = capabilitiesProp ? null : device?._id;
    const { capabilities: fetched } = useDeviceCapabilities(deviceId);
    const capabilities = capabilitiesProp ?? fetched;

    return (
        <Stack spacing={2} sx={{ p: 1 }}>
            <DeviceControls
                device={device}
                capabilities={capabilities}
                onStateChange={onStateChange}
                state={state}
                loading={loading}
            />
            {!capabilities && (
                <Typography variant="body2" color="text.secondary">
                    Aucune capacitÃ© dÃ©clarÃ©e pour cet appareil.
                </Typography>
            )}
        </Stack>
    );
};

export default DeviceControls;
