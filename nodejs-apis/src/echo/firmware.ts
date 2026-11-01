import fs from 'fs';
import path from 'path';

/**
 * Firmware versions published for the echo devices.
 *
 * The binaries served to the devices (`/api/echo/:type/latest/firmware.bin`)
 * embed their own version, so the server cannot read it back from the file.
 * The `firmware.json` manifest, committed next to the sources in `echo-devices`,
 * is the source of truth used to decide whether a device is up to date.
 */

/** Directory of the `echo-devices` repository (same mount as `api.ts`). */
const DIR = '../echo-devices';

/** Version published for a device type. */
export interface FirmwareEntry {
    version: string;
    /** ESP32HomeAssistant library version shipped with that firmware. */
    lib?: string;
}

/** Content of `echo-devices/firmware.json`. */
export interface FirmwareManifest {
    generatedAt?: string;
    devices: { [deviceType: string]: FirmwareEntry };
}

export type FirmwareStatus =
    | 'no-manifest'
    | 'unknown-type'
    | 'unknown-version'
    | 'update-available'
    | 'up-to-date'
    | 'ahead-of-manifest';

/** Result of comparing a device with the manifest. */
export interface FirmwareCheck {
    status: FirmwareStatus;
    deviceType?: string;
    /** Version reported by the device. */
    reported?: string;
    /** Version published in the manifest. */
    latest?: string;
    /** Library version published in the manifest (informative only). */
    latestLib?: string;
    /** True when the server should ask the device to update. */
    updateAvailable: boolean;
    /** Human readable explanation, logged with the decision. */
    reason: string;
}

/** Numeric segments of a version string (`v1.2.3-rc1` -> `[1, 2, 3]`). */
function parseVersion(version?: string | null): number[] | null {
    const clean = String(version ?? '')
        .trim()
        .replace(/^v/i, '')
        // Pre-release / build metadata is ignored for the comparison.
        .split(/[-+]/)[0];
    if (!clean) return null;

    const segments = clean.split('.');
    if (segments.some((segment) => !/^\d+$/.test(segment.trim()))) return null;
    return segments.map((segment) => Number(segment.trim()));
}

/**
 * Semver-ish comparison tolerant to the short forms used by the firmware:
 * missing segments count as zero (`1.0` === `1.0.0`) and pre-release suffixes
 * are ignored. Returns `null` when either value cannot be parsed, so an
 * unreadable version is never mistaken for "older".
 */
export function compareVersions(
    a?: string | null,
    b?: string | null
): number | null {
    const left = parseVersion(a);
    const right = parseVersion(b);
    if (!left || !right) return null;

    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i++) {
        const difference = (left[i] ?? 0) - (right[i] ?? 0);
        if (difference !== 0) return difference > 0 ? 1 : -1;
    }
    return 0;
}

/** Path of the manifest, overridable for tests. */
export function firmwareManifestPath(): string {
    return (
        process.env.ECHO_FIRMWARE_MANIFEST ?? path.join(DIR, 'firmware.json')
    );
}

/** Cached manifest, invalidated when the file changes on disk. */
let cache: { mtimeMs: number; manifest: FirmwareManifest } | null = null;

/**
 * Load `firmware.json`, re-reading it only when its modification time changed
 * (so a rebuilt manifest is picked up without restarting the server).
 * Returns `null` when the file is missing or malformed: the server then leaves
 * the devices alone instead of pushing a firmware it knows nothing about.
 */
export function loadFirmwareManifest(): FirmwareManifest | null {
    const file = firmwareManifestPath();
    try {
        const stats = fs.statSync(file);
        if (cache && cache.mtimeMs === stats.mtimeMs) return cache.manifest;

        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!parsed?.devices || typeof parsed.devices !== 'object') {
            console.log(`[firmware] ${file} has no "devices" object`);
            return null;
        }

        cache = { mtimeMs: stats.mtimeMs, manifest: parsed };
        return parsed;
    } catch (e) {
        console.log(`[firmware] Could not read ${file}:`, e);
        return null;
    }
}

/** Drop the cached manifest (used by the tests). */
export function resetFirmwareCache(): void {
    cache = null;
}

/**
 * Compare a device with the version published for its type.
 *
 * The library version is reported but never decides an update on its own:
 * firmware and library ship together, and a lib-only mismatch would flash the
 * device without changing anything.
 */
export function checkFirmware(
    manifest: FirmwareManifest | null,
    deviceType?: string | null,
    reportedVersion?: string | null
): FirmwareCheck {
    if (!manifest) {
        return {
            status: 'no-manifest',
            deviceType: deviceType ?? undefined,
            reported: reportedVersion ?? undefined,
            updateAvailable: false,
            reason: 'firmware manifest not available',
        };
    }

    const type = String(deviceType ?? '').trim();
    if (!type) {
        return {
            status: 'unknown-type',
            reported: reportedVersion ?? undefined,
            updateAvailable: false,
            reason: 'device did not report its type',
        };
    }

    const entry = manifest.devices[type];
    if (!entry?.version) {
        return {
            status: 'unknown-type',
            deviceType: type,
            reported: reportedVersion ?? undefined,
            updateAvailable: false,
            reason: `no firmware published for "${type}"`,
        };
    }

    const comparison = compareVersions(reportedVersion, entry.version);
    if (comparison === null) {
        return {
            status: 'unknown-version',
            deviceType: type,
            reported: reportedVersion ?? undefined,
            latest: entry.version,
            latestLib: entry.lib,
            updateAvailable: true,
            reason: `reported version "${
                reportedVersion ?? ''
            }" is unknown, latest is ${entry.version}`,
        };
    }

    if (comparison < 0) {
        return {
            status: 'update-available',
            deviceType: type,
            reported: reportedVersion ?? undefined,
            latest: entry.version,
            latestLib: entry.lib,
            updateAvailable: true,
            reason: `${reportedVersion} < ${entry.version}`,
        };
    }

    if (comparison > 0) {
        return {
            status: 'ahead-of-manifest',
            deviceType: type,
            reported: reportedVersion ?? undefined,
            latest: entry.version,
            latestLib: entry.lib,
            updateAvailable: false,
            reason: `${reportedVersion} > ${entry.version} (manifest is behind)`,
        };
    }

    return {
        status: 'up-to-date',
        deviceType: type,
        reported: reportedVersion ?? undefined,
        latest: entry.version,
        latestLib: entry.lib,
        updateAvailable: false,
        reason: `already on ${entry.version}`,
    };
}
