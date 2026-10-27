import { EchoOtaState, EchoSettings, EchoVersions } from '../types';
import {
    FirmwareCheck,
    checkFirmware,
    loadFirmwareManifest,
} from './firmware';
import {
    echoSettingsId,
    encodeEchoId,
    findEchoSettingsByIp,
    saveEchoSettings,
} from './identity';
import { logEcho } from './logs';
import { startOTA } from './service';

/**
 * Automatic over-the-air updates.
 *
 * A device that reports a type known to the manifest is asked to update as
 * soon as its firmware is older than the published version — or unknown, which
 * is the case for firmware predating version reporting.
 *
 * The firmware downloads the binary and reboots without comparing versions
 * itself, so the server is the only guard against a reboot loop: attempts are
 * counted per reported version and stop once the device keeps coming back with
 * the same old version (the manifest then does not match the served binary).
 */

/** Minimum delay between two automatic attempts for the same version. */
export const OTA_COOLDOWN_MS = 30 * 60 * 1000;
/** Attempts allowed for the same reported version before giving up. */
export const OTA_MAX_ATTEMPTS = 3;

export type OtaOutcome = 'triggered' | 'skipped' | 'not-needed';

/** Result of a version check plus the action taken by the server. */
export interface OtaDecision extends FirmwareCheck {
    outcome: OtaOutcome;
    /** Attempts made for the currently reported version. */
    attempts?: number;
    /** True when the automatic retries were given up. */
    stuck?: boolean;
}

export interface OtaContext {
    ip: string;
    /** Canonical id of the settings document (MAC when known). */
    id?: string;
    /** Versions reported by the device. */
    reported?: EchoVersions;
    /** Settings document as it was *before* this connect's versions write. */
    previous?: EchoSettings | null;
    /** Injectable clock, for the tests. */
    now?: Date;
}

/** Id of the document the OTA state is written to. */
function settingsId(ctx: OtaContext): string {
    const { previous, reported } = ctx;
    return (
        ctx.id ??
        encodeEchoId(
            previous?.mac ?? reported?.mac ?? previous?.ip ?? ctx.ip
        )
    );
}

/** Persist the state of a device that needs no update (resets the counters). */
async function clearOtaState(
    ctx: OtaContext,
    check: FirmwareCheck,
    reportedVersion?: string
): Promise<void> {
    // Nothing was ever attempted: leave the document untouched.
    if (!ctx.previous?.ota) return;
    await saveEchoSettings(settingsId(ctx), {
        ota: {
            attempts: 0,
            stuck: false,
            reportedVersion: reportedVersion ?? '',
            lastStatus: check.status,
        },
    });
}

/**
 * Decide whether the device connected from `ctx.ip` must be updated and, when
 * it must, send it the `OTA` command.
 *
 * Safe by design: a device whose type is unknown is never flashed (the server
 * would not know which binary to serve), and repeated attempts for the same
 * reported version stop after `OTA_MAX_ATTEMPTS`.
 */
export async function maybeStartOta(ctx: OtaContext): Promise<OtaDecision> {
    const now = ctx.now ?? new Date();
    const { reported, previous } = ctx;

    const deviceType =
        reported?.type ?? previous?.deviceType ?? previous?.versions?.type;
    const reportedVersion =
        reported?.device ?? previous?.versions?.device;

    const check = checkFirmware(
        loadFirmwareManifest(),
        deviceType,
        reportedVersion
    );

    if (!check.updateAvailable) {
        await clearOtaState(ctx, check, reportedVersion);
        return { ...check, outcome: 'not-needed' };
    }

    const prior = previous?.ota;
    // An unknown reported version is stored as an empty string: Mongo drops
    // `undefined` values on write, and a missing marker would reset the counter
    // on every connect and make the device reboot forever.
    const reportedKey = reportedVersion ?? '';
    const sameVersion =
        !!prior && (prior.reportedVersion ?? '') === reportedKey;
    const attempts = sameVersion ? prior?.attempts ?? 0 : 0;

    if (sameVersion && prior?.stuck) {
        return { ...check, outcome: 'skipped', attempts, stuck: true };
    }

    if (sameVersion && attempts >= OTA_MAX_ATTEMPTS) {
        const ota: EchoOtaState = {
            ...prior,
            attempts,
            reportedVersion: reportedKey,
            stuck: true,
            lastStatus: check.status,
        };
        await saveEchoSettings(settingsId(ctx), { ota });
        await logEcho(
            ctx.ip,
            `OTA stuck: still reporting ${
                reportedVersion ?? '?'
            } after ${attempts} attempts, no more automatic retries`
        );
        return { ...check, outcome: 'skipped', attempts, stuck: true };
    }

    const lastAttemptAt = prior?.lastAttemptAt
        ? new Date(prior.lastAttemptAt).getTime()
        : 0;
    if (sameVersion && now.getTime() - lastAttemptAt < OTA_COOLDOWN_MS) {
        return { ...check, outcome: 'skipped', attempts, stuck: false };
    }

    await startOTA(ctx.ip);

    const ota: EchoOtaState = {
        lastAttemptAt: now,
        attempts: attempts + 1,
        reportedVersion: reportedKey,
        stuck: false,
        lastStatus: check.status,
    };
    await saveEchoSettings(settingsId(ctx), { ota });
    await logEcho(
        ctx.ip,
        `OTA triggered (${check.status}): ${check.reason}`
    );

    return {
        ...check,
        outcome: 'triggered',
        attempts: ota.attempts,
        stuck: false,
    };
}

/**
 * Check a device that connected but did not report its `versions` within the
 * fallback delay. Firmware predating version reporting sends nothing on
 * connect, so the server falls back to the settings saved for its address.
 * A device whose type is unknown is left alone: without it the server would
 * not know which binary to serve.
 */
export async function maybeStartOtaForSilentDevice(
    ip: string
): Promise<OtaDecision | null> {
    try {
        const settings = await findEchoSettingsByIp(ip);
        if (!settings) return null;
        const deviceType = settings.deviceType ?? settings.versions?.type;
        if (!deviceType) return null;

        return await maybeStartOta({
            ip,
            id: echoSettingsId(settings),
            reported: settings.versions,
            previous: settings,
        });
    } catch (e) {
        console.log(`[ota] Silent device check failed for ${ip}:`, e);
        return null;
    }
}
