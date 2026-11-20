/**
 * The durable properties of a **camera device**: the rows the device page
 * renders from `capabilities.state`, and the canonicalization applied to a
 * write.
 *
 * It lives outside the `camera` provider because the row belongs to the device
 * **type**, not to a codesource. An HA camera's provider row is
 * `homeassistant` (shared with every other HA device), so a schema declared by
 * the `camera` provider would never reach it — while the mode selection is
 * meaningful for both. `devices/device-properties.ts` registers this profile
 * under `DeviceTypes.camera`, and `getDeviceCapabilities` merges it into
 * whatever the provider declared.
 *
 * Pure: no I/O.
 */
import { PropertyValue, StatePropertySchema } from '../types';
import { visionModeOptions, visionModesCsv } from './modes';

/**
 * `visionModes` — the selection, as a CSV of mode ids (the flat
 * `PropertyValue` vocabulary has no arrays). A generic durable device property
 * (`Device.properties`, the twin of `Provider.properties`), never `state`: five
 * writers `$set` the whole state bag, so anything kept there is wiped by the
 * next gateway event.
 *
 * No mode selected = the camera is not analysed at all (there is deliberately
 * no `off` mode: an empty selection cannot mean anything else).
 */
export const CAMERA_DEVICE_PROPERTIES: StatePropertySchema[] = [
    {
        key: 'visionModes',
        label: 'Modes',
        type: 'multienum',
        options: visionModeOptions(),
        description:
            "Aucun mode sélectionné = la caméra n'est pas analysée. Chaque mode apporte ses classes, son seuil de présence et son comportement.",
    },
];

/**
 * Canonicalize a camera write before it is stored: the selection is
 * re-serialized from the mode table (unknown ids dropped, table order), so what
 * the feed reads back is what this store actually understood.
 */
export function canonicalizeCameraProperties(
    patch: Record<string, PropertyValue>
): Record<string, PropertyValue> {
    if (!('visionModes' in patch)) return patch;
    return { ...patch, visionModes: visionModesCsv(patch.visionModes) };
}
