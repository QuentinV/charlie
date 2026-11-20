/**
 * The **durable device property bag** (`Device.properties`) — the twin of
 * `Provider.properties`.
 *
 * It is the one place a device keeps configuration that must survive a state
 * write: five writers `$set` the whole `state` bag (HA sync, MQTT, the provider
 * read-back, the automations bus…), so anything kept there is wiped by the next
 * gateway event. Nothing camera-specific is involved — this is the generic path
 * every device type uses.
 *
 * Two halves:
 *
 * - the **storage** helpers (`cleanProperties`, `writeDeviceProperties`), used
 *   by `devices/index.ts` when the provider declares no hook of its own. The
 *   write is a **dotted** `$set` per key, so writing one property never drops a
 *   sibling;
 * - the **per-type catalogue** (`DEVICE_PROPERTY_PROFILES`): the rows a device
 *   type owns whatever provider serves it, plus the canonicalization of a
 *   write. A camera's `visionModes` is the first one, and it has to work for an
 *   HA camera too (whose provider row is shared with every other HA device),
 *   which is why the row cannot live in the `camera` provider.
 */
import {
    CAMERA_DEVICE_PROPERTIES,
    canonicalizeCameraProperties,
} from '../cameras/properties';
import { cs } from '../core/db';
import {
    Device,
    DeviceTypes,
    PropertyValue,
    StatePropertySchema,
} from '../types';

/** The bag is flat scalars: `Record<string, PropertyValue>`. */
export function isPropertyValue(value: unknown): value is PropertyValue {
    return (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    );
}

/** A patch reduced to the keys the bag can hold (arrays/objects dropped). */
export function cleanProperties(
    patch?: Record<string, unknown>
): Record<string, PropertyValue> {
    const clean: Record<string, PropertyValue> = {};
    for (const [key, value] of Object.entries(patch ?? {})) {
        if (isPropertyValue(value)) clean[key] = value;
    }
    return clean;
}

/**
 * Merge a patch into a device's bag with a **dotted** `$set` per key.
 *
 * Dotted, and never `$set: { properties }`: the bag is shared by every durable
 * device property, so writing one must not drop a sibling. The device object is
 * updated in place as well, so a caller reading it right after sees its own
 * write.
 */
export async function writeDeviceProperties(
    device: Device,
    patch?: Record<string, unknown>
): Promise<Record<string, PropertyValue>> {
    const clean = cleanProperties(patch);
    const entries = Object.entries(clean);

    if (device._id && entries.length) {
        await cs.devices.updateOne(
            { _id: device._id },
            {
                $set: Object.fromEntries(
                    entries.map(([key, value]) => [`properties.${key}`, value])
                ),
            }
        );
    }

    const properties = { ...(device.properties ?? {}), ...clean };
    device.properties = properties;
    return properties;
}

/** What a device type owns in the bag, whatever provider serves it. */
export interface DevicePropertyProfile {
    /** Rows appended to the ones the provider declared. */
    schema: StatePropertySchema[];
    /** Canonicalize a write before it is stored (unknown values dropped…). */
    canonicalize?: (
        patch: Record<string, PropertyValue>
    ) => Record<string, PropertyValue>;
}

export const DEVICE_PROPERTY_PROFILES: {
    [type: string]: DevicePropertyProfile;
} = {
    [DeviceTypes.camera]: {
        schema: CAMERA_DEVICE_PROPERTIES,
        canonicalize: canonicalizeCameraProperties,
    },
};

export function devicePropertyProfile(
    type?: string
): DevicePropertyProfile | undefined {
    return type ? DEVICE_PROPERTY_PROFILES[type] : undefined;
}

/**
 * The type's rows, appended to whatever the provider declared. A type with no
 * profile keeps exactly what its provider advertised (never a duplicate row).
 */
export function withDeviceProperties(
    declared: StatePropertySchema[] | undefined,
    type?: string
): StatePropertySchema[] | undefined {
    const profile = devicePropertyProfile(type);
    if (!profile) return declared;
    return [...(declared ?? []), ...profile.schema];
}

/** The type's canonicalization of a write, or the patch untouched. */
export function canonicalizeDeviceProperties(
    type: string | undefined,
    patch: Record<string, PropertyValue>
): Record<string, PropertyValue> {
    const profile = devicePropertyProfile(type);
    return profile?.canonicalize ? profile.canonicalize(patch) : patch;
}
