import { cs } from '../core/db';
import { getDeviceState } from '../devices';
import { logDeviceState } from '../devices/history';
import { log } from '../manager/services/activities';
import { connectedEchos, getEchoMacByIp } from './listen';
import { findEchoSettingsByIp } from './identity';
import { updateDisplays } from './service';

const intervalHandles: { [ip: string]: ReturnType<typeof setInterval> } = {};

/**
 * Device lookups + refreshed states, shared by EVERY screen of EVERY echo.
 *
 * A screen usually repeats the same device (`{{device:Salon:state.level}}` on
 * two lines, the same `Météo` reading on three screens), and a home often has
 * several echos refreshing at once. Resolving each placeholder on its own would
 * re-read the device document and re-poll the provider for each of them.
 *
 * The entry lives just long enough for one refresh wave (`SCREEN_STATE_TTL_MS`),
 * so a 30 s refresh cycle always sees a fresh reading, while the texts of one
 * pass — and the passes of echos refreshing in the same tick — share a single
 * `getDeviceState()` + `logDeviceState()` per device.
 */
const SCREEN_STATE_TTL_MS = 1000;

interface CachedDevice {
    at: number;
    /** The document as stored when the state was refreshed. */
    device: any;
    /** The state returned by `getDeviceState()` (never the stale doc state). */
    state: any;
}

const deviceCache = new Map<string, CachedDevice>();
/** Single-flight guard: concurrent screens of one wave await the same load. */
const pendingDevices = new Map<string, Promise<CachedDevice | null>>();

function cacheKey(deviceName: string): string {
    return deviceName.trim().toLowerCase();
}

/** Drop the wave cache (tests, or after a device was renamed/deleted). */
export function resetScreenDeviceCache(): void {
    deviceCache.clear();
    pendingDevices.clear();
}

/**
 * Find a device by name and refresh its state at most once per wave.
 * Returns `null` when no device matches (a miss is never cached).
 */
async function loadDevice(deviceName: string): Promise<CachedDevice | null> {
    const key = cacheKey(deviceName);

    const cached = deviceCache.get(key);
    if (cached && Date.now() - cached.at < SCREEN_STATE_TTL_MS) return cached;

    const inFlight = pendingDevices.get(key);
    if (inFlight) return inFlight;

    const promise = (async (): Promise<CachedDevice | null> => {
        const device = await cs.devices.findOne({
            name: {
                $regex: new RegExp(`^${escapeRegex(deviceName)}$`, 'i'),
            },
        });
        if (!device) return null;

        // The document above predates the refresh: resolve against the FRESH
        // state, otherwise a screen is always one refresh behind (and the first
        // paint shows nothing).
        const freshState = await getDeviceState(device._id);
        await logDeviceState({ deviceId: device._id });

        const entry: CachedDevice = {
            at: Date.now(),
            device,
            state: freshState ?? device.state,
        };
        deviceCache.set(key, entry);
        return entry;
    })();

    pendingDevices.set(key, promise);
    try {
        return await promise;
    } finally {
        pendingDevices.delete(key);
    }
}

/**
 * Read one value out of a cached device.
 *
 * The document exposes its readings under `state`, so the canonical form is
 * `{{device:Salon:state.level}}`. The documented shorthand
 * `{{device:Salon:power}}` keeps working: a bare name that is not a field of
 * the device is looked up in its state, exactly where a reading lives.
 */
function resolveDeviceProperty(entry: CachedDevice, path: string): any {
    const value = resolvePropertyPath(
        { ...entry.device, state: entry.state },
        path
    );
    if (value !== undefined) return value;
    if (path.includes('.')) return undefined;
    return resolvePropertyPath(entry.state, path);
}

/**
 * Resolves scripting in text values.
 * Supports {{device:DeviceName:property}} syntax.
 * Example: {{device:Lumière salon:power}} -> "on"
 * Supports nested properties like {{device:Temperature:state.temperature}}
 */
async function resolveScripting(v: string): Promise<string> {
    const regex = /\{\{device:([^:]+?):([^}]+?)\}\}/g;
    let match;
    let result = v;

    while ((match = regex.exec(v)) !== null) {
        const [fullMatch, deviceName, propertyPath] = match;

        try {
            const entry = await loadDevice(deviceName);
            const resolvedValue = entry
                ? resolveDeviceProperty(entry, propertyPath)
                : undefined;

            // Replacer functions, not strings: a reading must never be read as
            // a replacement pattern (`$&`, `$1`…).
            if (entry && resolvedValue !== undefined && resolvedValue !== null) {
                result = result.replace(fullMatch, () => String(resolvedValue));
            } else if (entry) {
                result = result.replace(
                    fullMatch,
                    () => `??${deviceName}:${propertyPath}??`
                );
            } else {
                result = result.replace(
                    fullMatch,
                    () => `??${deviceName}:not found??`
                );
            }
        } catch (e) {
            console.log(
                `[screensUpdates] Error resolving script for "${fullMatch}":`,
                e
            );
            result = result.replace(fullMatch, () => `??error??`);
        }
    }

    return result;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolvePropertyPath(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
    }
    return current;
}

/**
 * Refresh screens for a specific echo device.
 */
async function refreshScreensForIp(ip: string): Promise<void> {
    try {
        if (!connectedEchos[ip]) {
            // Device disconnected, clean up interval
            clearScreenUpdatesForIp(ip);
            return;
        }

        // Settings are keyed by the MAC of the device, with the ip as the
        // fallback for firmware that does not report one.
        const settings = await findEchoSettingsByIp(ip, getEchoMacByIp(ip));
        if (!settings?.screens?.screens?.length) return;

        const screens = settings.screens.screens;

        // Every screen of this echo is resolved in parallel: `loadDevice` is
        // single-flight and cached for the wave, so N screens × M texts still
        // cost ONE state refresh per device. Order is preserved (the request
        // array must match the screen keys).
        const requests = await Promise.all(
            screens.map(async (screen) => ({
                k: screen.k,
                texts: await Promise.all(
                    (screen.texts || []).map(async (text) => ({
                        ts: text.ts,
                        v: await resolveScripting(text.v),
                        cx: text.cx,
                        cy: text.cy,
                        r: text.r,
                    }))
                ),
            }))
        );

        await updateDisplays(ip, requests);
    } catch (e) {
        console.log(`[screensUpdates] Error refreshing screens for ${ip}:`, e);
    }
}

/**
 * Start periodic screen updates for a specific echo IP.
 */
export async function startScreenUpdatesForIp(ip: string): Promise<void> {
    clearScreenUpdatesForIp(ip); // Clear any existing interval first

    // Load settings to get refreshTime (MAC keyed, ip as fallback).
    const settings = await findEchoSettingsByIp(ip, getEchoMacByIp(ip));
    if (!settings?.screens?.refreshTime) {
        log(
            `echoScreensUpdates`,
            `No screen refreshTime configured for ${ip}, skipping`
        );
        return;
    }

    const refreshTimeMs = settings.screens.refreshTime * 1000;
    log(
        `echoScreensUpdates`,
        `Starting screen updates for ${ip} every ${settings.screens.refreshTime}s`
    );

    refreshScreensForIp(ip);
    intervalHandles[ip] = setInterval(() => {
        refreshScreensForIp(ip);
    }, refreshTimeMs);
}

/**
 * Stop periodic screen updates for a specific echo IP.
 */
export function clearScreenUpdatesForIp(ip: string): void {
    if (!intervalHandles[ip]) return;
    clearInterval(intervalHandles[ip]);
    delete intervalHandles[ip];
    console.log(`[screensUpdates] Stopped screen updates for ${ip}`);
}
