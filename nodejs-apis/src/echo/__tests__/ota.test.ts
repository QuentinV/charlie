import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('../identity', () => ({
    findEchoSettingsByIp: jest.fn(),
    saveEchoSettings: jest.fn(),
    echoSettingsId: jest.fn(() => 'aa-bb-cc-dd-ee-ff'),
    encodeEchoId: jest.fn((value: string) => value),
}));
jest.mock('../service', () => ({ startOTA: jest.fn() }));
jest.mock('../logs', () => ({ logEcho: jest.fn() }));

import {
    maybeStartOta,
    maybeStartOtaForSilentDevice,
    OTA_COOLDOWN_MS,
    OTA_MAX_ATTEMPTS,
} from '../ota';
import { findEchoSettingsByIp, saveEchoSettings } from '../identity';
import { startOTA } from '../service';
import { logEcho } from '../logs';
import { resetFirmwareCache } from '../firmware';
import { EchoSettings } from '../../types';

const ID = 'aa-bb-cc-dd-ee-ff';
const IP = '192.168.1.42';

const saveMock = saveEchoSettings as jest.MockedFunction<
    typeof saveEchoSettings
>;
const findMock = findEchoSettingsByIp as jest.MockedFunction<
    typeof findEchoSettingsByIp
>;
const startMock = startOTA as jest.MockedFunction<typeof startOTA>;
const logMock = logEcho as jest.MockedFunction<typeof logEcho>;

/** Settings document of a device already tracked by the server. */
function settings(overrides: Partial<EchoSettings> = {}): EchoSettings {
    return {
        ip: IP,
        mac: 'aa:bb:cc:dd:ee:ff',
        deviceType: 'echo-zero',
        versions: {
            type: 'echo-zero',
            device: '1.0.0',
            mac: 'aa:bb:cc:dd:ee:ff',
        },
        ...overrides,
    };
}

const NOW = new Date('2026-10-27T12:00:00.000Z');

let manifestFile: string;

beforeEach(() => {
    manifestFile = path.join(
        os.tmpdir(),
        `ota-firmware-${process.pid}-${Date.now()}.json`
    );
    fs.writeFileSync(
        manifestFile,
        JSON.stringify({
            devices: { 'echo-zero': { version: '1.2.0', lib: '1.2.0' } },
        })
    );
    process.env.ECHO_FIRMWARE_MANIFEST = manifestFile;
    resetFirmwareCache();
    saveMock.mockReset();
    findMock.mockReset();
    startMock.mockReset();
    logMock.mockReset();
});

afterEach(() => {
    delete process.env.ECHO_FIRMWARE_MANIFEST;
    resetFirmwareCache();
    if (fs.existsSync(manifestFile)) fs.unlinkSync(manifestFile);
});

describe('maybeStartOta', () => {
    test('leaves a device already on the latest firmware alone', async () => {
        const decision = await maybeStartOta({
            ip: IP,
            id: ID,
            reported: { type: 'echo-zero', device: '1.2.0' },
            previous: settings({
                versions: { type: 'echo-zero', device: '1.2.0' },
            }),
            now: NOW,
        });

        expect(decision.outcome).toBe('not-needed');
        expect(decision.status).toBe('up-to-date');
        expect(startMock).not.toHaveBeenCalled();
    });

    test('triggers an update for an older firmware and records it', async () => {
        const decision = await maybeStartOta({
            ip: IP,
            id: ID,
            reported: { type: 'echo-zero', device: '1.0.0' },
            previous: null,
            now: NOW,
        });

        expect(decision.outcome).toBe('triggered');
        expect(decision.status).toBe('update-available');
        expect(decision.attempts).toBe(1);
        expect(startMock).toHaveBeenCalledWith(IP);
        expect(saveMock).toHaveBeenCalledWith(ID, {
            ota: {
                lastAttemptAt: NOW,
                attempts: 1,
                reportedVersion: '1.0.0',
                stuck: false,
                lastStatus: 'update-available',
            },
        });
        expect(logMock).toHaveBeenCalled();
    });

    test('triggers an update when the device never reported its version', async () => {
        const decision = await maybeStartOta({
            ip: IP,
            id: ID,
            reported: { type: 'echo-zero' },
            previous: null,
            now: NOW,
        });

        expect(decision.outcome).toBe('triggered');
        expect(decision.status).toBe('unknown-version');
        expect(startMock).toHaveBeenCalledTimes(1);
        expect(saveMock).toHaveBeenCalledWith(
            ID,
            expect.objectContaining({
                ota: expect.objectContaining({
                    attempts: 1,
                    reportedVersion: '',
                }),
            })
        );
    });

    test('skips a device that was attempted too recently', async () => {
        const decision = await maybeStartOta({
            ip: IP,
            id: ID,
            reported: { type: 'echo-zero', device: '1.0.0' },
            previous: settings({
                ota: {
                    lastAttemptAt: new Date(NOW.getTime() - 60 * 1000),
                    attempts: 1,
                    reportedVersion: '1.0.0',
                    stuck: false,
                },
            }),
            now: NOW,
        });

        expect(decision.outcome).toBe('skipped');
        expect(decision.attempts).toBe(1);
        expect(startMock).not.toHaveBeenCalled();
        expect(saveMock).not.toHaveBeenCalled();
    });

    test('retries once the cooldown elapsed and increments the counter', async () => {
        const decision = await maybeStartOta({
            ip: IP,
            id: ID,
            reported: { type: 'echo-zero', device: '1.0.0' },
            previous: settings({
                ota: {
                    lastAttemptAt: new Date(
                        NOW.getTime() - OTA_COOLDOWN_MS - 1
                    ),
                    attempts: 1,
                    reportedVersion: '1.0.0',
                    stuck: false,
                },
            }),
            now: NOW,
        });

        expect(decision.outcome).toBe('triggered');
        expect(decision.attempts).toBe(2);
        expect(startMock).toHaveBeenCalledTimes(1);
    });

    test('marks the device stuck after the maximum attempts', async () => {
        const decision = await maybeStartOta({
            ip: IP,
            id: ID,
            reported: { type: 'echo-zero', device: '1.0.0' },
            previous: settings({
                ota: {
                    lastAttemptAt: new Date(
                        NOW.getTime() - OTA_COOLDOWN_MS - 1
                    ),
                    attempts: OTA_MAX_ATTEMPTS,
                    reportedVersion: '1.0.0',
                    stuck: false,
                },
            }),
            now: NOW,
        });

        expect(decision.outcome).toBe('skipped');
        expect(decision.stuck).toBe(true);
        expect(startMock).not.toHaveBeenCalled();
        expect(saveMock).toHaveBeenCalledWith(
            ID,
            expect.objectContaining({
                ota: expect.objectContaining({
                    attempts: OTA_MAX_ATTEMPTS,
                    stuck: true,
                }),
            })
        );
    });

    test('never retries a device already flagged as stuck', async () => {
        const decision = await maybeStartOta({
            ip: IP,
            id: ID,
            reported: { type: 'echo-zero', device: '1.0.0' },
            previous: settings({
                ota: {
                    lastAttemptAt: new Date(
                        NOW.getTime() - OTA_COOLDOWN_MS - 1
                    ),
                    attempts: OTA_MAX_ATTEMPTS,
                    reportedVersion: '1.0.0',
                    stuck: true,
                },
            }),
            now: NOW,
        });

        expect(decision.outcome).toBe('skipped');
        expect(decision.stuck).toBe(true);
        expect(startMock).not.toHaveBeenCalled();
        expect(saveMock).not.toHaveBeenCalled();
    });

    test('a new reported version resets the attempt counter', async () => {
        const decision = await maybeStartOta({
            ip: IP,
            id: ID,
            reported: { type: 'echo-zero', device: '1.1.0' },
            previous: settings({
                ota: {
                    lastAttemptAt: new Date(
                        NOW.getTime() - OTA_COOLDOWN_MS - 1
                    ),
                    attempts: OTA_MAX_ATTEMPTS,
                    reportedVersion: '1.0.0',
                    stuck: true,
                },
            }),
            now: NOW,
        });

        expect(decision.outcome).toBe('triggered');
        expect(decision.attempts).toBe(1);
        expect(startMock).toHaveBeenCalledTimes(1);
    });

    test('clears the counters once the device is up to date', async () => {
        const decision = await maybeStartOta({
            ip: IP,
            id: ID,
            reported: { type: 'echo-zero', device: '1.2.0' },
            previous: settings({
                ota: {
                    lastAttemptAt: NOW,
                    attempts: 2,
                    reportedVersion: '1.0.0',
                    stuck: false,
                },
                versions: { type: 'echo-zero', device: '1.0.0' },
            }),
            now: NOW,
        });

        expect(decision.outcome).toBe('not-needed');
        expect(saveMock).toHaveBeenCalledWith(ID, {
            ota: expect.objectContaining({
                attempts: 0,
                stuck: false,
                reportedVersion: '1.2.0',
                lastStatus: 'up-to-date',
            }),
        });
    });
});

describe('maybeStartOtaForSilentDevice', () => {
    test('triggers an update from the saved settings when no versions arrive', async () => {
        findMock.mockResolvedValue(
            settings({ versions: { type: 'echo-zero', device: '1.0.0' } })
        );

        const decision = await maybeStartOtaForSilentDevice(IP);

        expect(decision?.outcome).toBe('triggered');
        expect(startMock).toHaveBeenCalledWith(IP);
        expect(saveMock).toHaveBeenCalledWith(
            ID,
            expect.objectContaining({
                ota: expect.objectContaining({ attempts: 1 }),
            })
        );
    });

    test('leaves a device without saved settings alone', async () => {
        findMock.mockResolvedValue(null);

        const decision = await maybeStartOtaForSilentDevice(IP);

        expect(decision).toBeNull();
        expect(startMock).not.toHaveBeenCalled();
        expect(saveMock).not.toHaveBeenCalled();
    });

    test('skips a silent device whose type was never recorded', async () => {
        findMock.mockResolvedValue(
            settings({ deviceType: undefined, versions: {} })
        );

        const decision = await maybeStartOtaForSilentDevice(IP);

        expect(decision).toBeNull();
        expect(startMock).not.toHaveBeenCalled();
        expect(saveMock).not.toHaveBeenCalled();
    });

    test('does not act when the settings lookup fails', async () => {
        findMock.mockRejectedValue(new Error('mongo down'));
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        try {
            const decision = await maybeStartOtaForSilentDevice(IP);

            expect(decision).toBeNull();
            expect(startMock).not.toHaveBeenCalled();
            expect(saveMock).not.toHaveBeenCalled();
        } finally {
            logSpy.mockRestore();
        }
    });
});
