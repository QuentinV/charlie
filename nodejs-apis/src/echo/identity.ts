import { cs } from '../core/db';
import { EchoSettings, EchoVersions } from '../types';

/**
 * Echo identity helpers.
 *
 * A device is addressed by two values with different lifecycles:
 *
 * - the **IP** is the transport address of the live WebSocket connection and
 *   can change on any DHCP lease renewal.
 * - the **MAC** is the canonical identity, reported in the `versions` message
 *   the firmware sends on every connect: the settings saved from the UI
 *   (`echo_settings`) are keyed by it, so they follow the physical device
 *   across IP changes.
 *
 * Documents written by firmware that does not report a MAC stay keyed by IP;
 * the first connect that reports one adopts the legacy document instead of
 * leaving its settings behind.
 */

const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/;
const MAC_ID_RE = /^([0-9a-f]{2}-){5}[0-9a-f]{2}$/i;

/** `::ffff:192.168.1.42` / `[::ffff:192.168.1.42]` -> `192.168.1.42`. */
export function normalizeIp(raw?: string | null): string {
    let ip = String(raw ?? '').trim();
    if (ip.startsWith('[') && ip.endsWith(']')) {
        ip = ip.slice(1, -1);
    }
    if (ip.toLowerCase().startsWith('::ffff:')) {
        ip = ip.slice(7);
    }
    return ip;
}

/** `AA-BB-CC-DD-EE-FF` -> `aa:bb:cc:dd:ee:ff`; `undefined` when malformed. */
export function normalizeMac(raw?: string | null): string | undefined {
    const mac = String(raw ?? '')
        .trim()
        .toLowerCase()
        .replace(/-/g, ':');
    return MAC_RE.test(mac) ? mac : undefined;
}

/** True for the dashed MAC form used in urls (`aa-bb-cc-dd-ee-ff`). */
export const isMacId = (id?: string | null): boolean =>
    MAC_ID_RE.test(String(id ?? '').trim());

/**
 * Stable url id of a device: dashes only, so a MAC becomes `aa-bb-cc-dd-ee-ff`
 * and an IP `192-168-1-42` (both accepted by the routes as `:id`).
 */
export function encodeEchoId(value?: string | null): string {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[:.]/g, '-');
}

/** Reverse of `encodeEchoId`: gives back either the MAC or the IP. */
export function decodeEchoId(id?: string | null): {
    mac?: string;
    ip?: string;
} {
    const clean = String(id ?? '').trim();
    const mac = isMacId(clean) ? normalizeMac(clean) : undefined;
    return mac ? { mac } : { ip: clean.replace(/-/g, '.') };
}

/**
 * Read filter matching an address in both of its stored forms: the plain one
 * and the legacy `::ffff:` prefix written by the first versions of the server.
 * Only usable to *find* documents: an upsert needs an equality filter, so the
 * update paths look the document up first and then write by `_id`.
 */
export function ipQuery(ip: string): any {
    const plain = normalizeIp(ip);
    return { $in: [plain, `::ffff:${plain}`] };
}

/** Mongo filter matching the document identified by a url id. */
export function echoSettingsFilter(id: string): any {
    const { mac, ip } = decodeEchoId(id);
    return mac ? { mac } : { ip: ipQuery(ip!) };
}

/** Canonical url id of a settings document (MAC as soon as it is known). */
export const echoSettingsId = (doc?: EchoSettings | null): string =>
    encodeEchoId(doc?.mac ?? doc?.ip);

/** Settings document of a device, from its url id (MAC when known). */
export async function findEchoSettingsById(
    id: string
): Promise<EchoSettings | null> {
    return (await cs.echoSettings.findOne(echoSettingsFilter(id))) ?? null;
}

/**
 * Settings of the device connected from `ip`. The MAC is tried first (the
 * device may already be known from another address); the IP of the current
 * connection is only the fallback for firmware that does not report one.
 */
export async function findEchoSettingsByIp(
    ip: string,
    mac?: string
): Promise<EchoSettings | null> {
    if (mac) {
        const byMac = await cs.echoSettings.findOne({ mac });
        if (byMac) return byMac;
    }
    return (await cs.echoSettings.findOne({ ip: ipQuery(ip) })) ?? null;
}

/**
 * Save a settings fragment for the device behind `id`, creating the document
 * when needed. The write goes through the MAC as soon as it is known, so the
 * same document is kept whatever IP the device announces afterwards.
 */
export async function saveEchoSettings(id: string, update: any): Promise<void> {
    const existing = await findEchoSettingsById(id);
    if (existing) {
        await cs.echoSettings.updateOne({ _id: existing._id }, { $set: update });
        return;
    }

    const { mac, ip } = decodeEchoId(id);
    if (mac) {
        await cs.echoSettings.updateOne(
            { mac },
            { $set: update },
            { upsert: true }
        );
        return;
    }

    // Firmware without MAC reporting: the address is the identity.
    await cs.echoSettings.updateOne(
        { ip: normalizeIp(ip!) },
        { $set: update },
        { upsert: true }
    );
}

/**
 * Persist what a device declared in its `versions` message and return the
 * canonical id the UI uses to address it.
 */
export async function registerVersions(
    ip: string,
    versions?: EchoVersions
): Promise<{ id: string; mac?: string }> {
    const plainIp = normalizeIp(ip);
    const mac = normalizeMac(versions?.mac);
    const reported: EchoVersions = { ...(versions ?? {}) };
    if (mac) reported.mac = mac;
    else delete reported.mac;

    const $set: any = {
        ip: plainIp,
        versions: reported,
        lastSeen: new Date(),
    };
    if (reported.type) $set.deviceType = reported.type;

    if (!mac) {
        // Old firmware: nothing identifies the device beyond its address.
        const existing = await cs.echoSettings.findOne({ ip: ipQuery(plainIp) });
        if (existing) {
            await cs.echoSettings.updateOne({ _id: existing._id }, { $set });
        } else {
            await cs.echoSettings.updateOne(
                { ip: plainIp },
                { $set },
                { upsert: true }
            );
        }
        return { id: encodeEchoId(plainIp) };
    }

    $set.mac = mac;

    const known = await cs.echoSettings.findOne({ mac });
    if (known) {
        await cs.echoSettings.updateOne({ _id: known._id }, { $set });
        return { id: encodeEchoId(mac), mac };
    }

    // First time this MAC is seen: adopt the document the device used to be
    // known by (its previous IP) so the settings saved there are not lost,
    // otherwise create it.
    const legacy = await cs.echoSettings.findOne({ ip: ipQuery(plainIp) });
    if (legacy) {
        await cs.echoSettings.updateOne({ _id: legacy._id }, { $set });
        return { id: encodeEchoId(mac), mac };
    }

    await cs.echoSettings.updateOne({ mac }, { $set }, { upsert: true });
    return { id: encodeEchoId(mac), mac };
}