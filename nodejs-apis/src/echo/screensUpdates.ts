import { cs } from '../core/db';
import { getDeviceState } from '../devices';
import { log } from '../manager/services/activities';
import { connectedEchos } from './listen';
import { updateDisplays } from './service';

const intervalHandles: { [ip: string]: ReturnType<typeof setInterval> } = {};

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

    // Cache device states keyed by device name to avoid reloading state
    // when a device is referenced multiple times in the same string.
    const deviceStateCache = new Map<string, any>();

    while ((match = regex.exec(v)) !== null) {
        const [fullMatch, deviceName, propertyPath] = match;

        try {
            const device = await cs.devices.findOne({
                name: {
                    $regex: new RegExp(`^${escapeRegex(deviceName)}$`, 'i'),
                },
            });

            if (device) {
                // Only load device state once per device per resolveScripting call
                if (!deviceStateCache.has(device.name)) {
                    await getDeviceState(device._id);
                    deviceStateCache.set(device.name, true);
                }
                const resolvedValue = resolvePropertyPath(device, propertyPath);
                if (resolvedValue !== undefined && resolvedValue !== null) {
                    result = result.replace(fullMatch, String(resolvedValue));
                } else {
                    result = result.replace(
                        fullMatch,
                        `??${deviceName}:${propertyPath}??`
                    );
                }
            } else {
                result = result.replace(
                    fullMatch,
                    `??${deviceName}:not found??`
                );
            }
        } catch (e) {
            console.log(
                `[screensUpdates] Error resolving script for "${fullMatch}":`,
                e
            );
            result = result.replace(fullMatch, `??error??`);
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

        const settings = await cs.echoSettings.findOne({ ip });
        if (!settings?.screens?.screens?.length) return;

        const screens = settings.screens.screens;
        const requests: {
            k: number;
            texts: {
                ts?: number;
                v: string;
                cx?: number;
                cy?: number;
                r?: number;
            }[];
        }[] = [];

        for (const screen of screens) {
            const resolvedTexts: {
                ts?: number;
                v: string;
                cx?: number;
                cy?: number;
                r?: number;
            }[] = [];

            for (const text of screen.texts || []) {
                const resolvedV = await resolveScripting(text.v);
                resolvedTexts.push({
                    ts: text.ts,
                    v: resolvedV,
                    cx: text.cx,
                    cy: text.cy,
                    r: text.r,
                });
            }

            requests.push({
                k: screen.k,
                texts: resolvedTexts,
            });
        }

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

    // Load settings to get refreshTime
    const settings = await cs.echoSettings.findOne({ ip });
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
