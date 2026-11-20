/**
 * The `camera` provider — Charlie's own camera support, **not** tied to Home
 * Assistant (an HA `camera` entity simply has an `homeassistant` provider row).
 *
 * A camera is an ordinary `Device` (`type: 'camera'`) under a **provider row
 * that is one camera**, like a Shelly provider row is one plug: the source
 * (`kind`, stream URL, snapshot URL, credentials) is provider config, edited in
 * the Providers page dialog (`CAMERA_PROVIDER_SETTINGS` →
 * `GET/PUT /api/providers/:id/settings`), and the device only names the remote
 * object (`externalId`).
 *
 * This module therefore declares **two** things and nothing else: the settings
 * of a camera provider row, and the fact that a camera has nothing to discover.
 * The mode selection (`device.properties.visionModes`) is a property of the
 * device **type**, so it is declared in `cameras/properties.ts` and merged into
 * the capabilities by the device layer — which is what makes it work for an HA
 * camera too, whose provider row is `homeassistant` and never reaches this file.
 * The source, likewise, is resolved from the provider row on demand
 * (`GET /api/devices/:id/source`) instead of being copied into the device state,
 * where the next state write would drop it.
 */
import { CAMERA_SOURCE_KINDS } from '../../../cameras/sources';
import {
    DiscoveryResult,
    ProviderApi,
    ProvidersApis,
    StatePropertySchema,
} from '../../../types';

/**
 * Settings of a camera **provider row**. Rendered by the generic Providers
 * dialog from this schema (no bespoke form): `kind` chooses how the feed pulls
 * frames, `host` is the stream URL (or the webcam index — the field a provider
 * already owns), `snapshotUrl` the single-frame endpoint of a live MJPEG stream.
 */
export const CAMERA_PROVIDER_SETTINGS: StatePropertySchema[] = [
    {
        key: 'kind',
        label: 'Type de source',
        type: 'enum',
        options: CAMERA_SOURCE_KINDS.map((value) => ({ value, label: value })),
        description:
            "Obligatoire : sans type, la caméra n'a pas de source. `webcam` = l'index, `rtsp`/`mjpeg` = l'URL du flux, `ha`/`echo` = une entité.",
    },
    { key: 'host', label: 'Source (index / URL)', type: 'string' },
    {
        key: 'snapshotUrl',
        label: "URL de l'instantané (flux MJPEG)",
        type: 'string',
    },
];

const api: ProviderApi = {
    // Cameras are added by hand (a URL) or synced from HA: nothing to probe.
    publicDiscover: async (): Promise<DiscoveryResult> => ({ devices: [] }),

    // No state and no properties of its own: a camera's durable config is the
    // generic device property bag (`visionModes`), and its source lives on the
    // provider row. The type's rows come from `devices/device-properties.ts`,
    // so this only has to answer "no functions".
    getCapabilities: async () => ({ functions: [] }),
};

const apis: ProvidersApis = { api, settings: CAMERA_PROVIDER_SETTINGS };

export default apis;
