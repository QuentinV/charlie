import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    FirmwareManifest,
    checkFirmware,
    compareVersions,
    echoDevicesDir,
    firmwareBinaryPath,
    firmwareManifestPath,
    loadFirmwareManifest,
    resetFirmwareCache,
    resolveFirmwareBinary,
} from '../firmware';

/** Manifest used by the checks below. */
const manifest: FirmwareManifest = {
    generatedAt: '2026-10-27T00:00:00.000Z',
    devices: {
        'echo-zero': { version: '1.0.0', lib: '1.2.0' },
        'echo-dashboard': { version: '2.1.3', lib: '1.2.0' },
    },
};

describe('compareVersions', () => {
    it('orders numeric segments', () => {
        expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
        expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
        expect(compareVersions('1.2.0', '1.1.9')).toBe(1);
        expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    });

    it('treats missing segments as zero', () => {
        expect(compareVersions('1.0', '1.0.0')).toBe(0);
        expect(compareVersions('1', '1.0.0')).toBe(0);
        expect(compareVersions('1.0', '1.0.1')).toBe(-1);
    });

    it('tolerates a leading v and ignores pre-release suffixes', () => {
        expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
        expect(compareVersions('1.2.3-rc1', '1.2.3')).toBe(0);
        expect(compareVersions('1.2.3+build7', '1.2.3')).toBe(0);
    });

    it('returns null when a version cannot be parsed', () => {
        expect(compareVersions(undefined, '1.0.0')).toBeNull();
        expect(compareVersions('', '1.0.0')).toBeNull();
        expect(compareVersions('dev', '1.0.0')).toBeNull();
        expect(compareVersions('1.x.0', '1.0.0')).toBeNull();
    });
});

describe('checkFirmware', () => {
    it('reports a missing manifest without triggering an update', () => {
        const check = checkFirmware(null, 'echo-zero', '0.9.0');
        expect(check.status).toBe('no-manifest');
        expect(check.updateAvailable).toBe(false);
    });

    it('reports a device type without a published firmware', () => {
        const check = checkFirmware(manifest, 'echo-unknown', '0.9.0');
        expect(check.status).toBe('unknown-type');
        expect(check.updateAvailable).toBe(false);
    });

    it('reports a device that did not declare its type', () => {
        const check = checkFirmware(manifest, undefined, '0.9.0');
        expect(check.status).toBe('unknown-type');
        expect(check.updateAvailable).toBe(false);
    });

    it('asks for an update when the version is older', () => {
        const check = checkFirmware(manifest, 'echo-zero', '0.9.9');
        expect(check.status).toBe('update-available');
        expect(check.updateAvailable).toBe(true);
        expect(check.latest).toBe('1.0.0');
        expect(check.latestLib).toBe('1.2.0');
    });

    it('asks for an update when the version is unknown', () => {
        // Firmware predating version reporting sends nothing: the manifest is
        // the only way to know it must be updated.
        const check = checkFirmware(manifest, 'echo-zero', undefined);
        expect(check.status).toBe('unknown-version');
        expect(check.updateAvailable).toBe(true);
    });

    it('does not update a device already on the latest version', () => {
        const check = checkFirmware(manifest, 'echo-zero', '1.0.0');
        expect(check.status).toBe('up-to-date');
        expect(check.updateAvailable).toBe(false);
    });

    it('does not downgrade a device ahead of the manifest', () => {
        const check = checkFirmware(manifest, 'echo-dashboard', '2.2.0');
        expect(check.status).toBe('ahead-of-manifest');
        expect(check.updateAvailable).toBe(false);
    });
});

describe('loadFirmwareManifest', () => {
    let file: string;

    beforeEach(() => {
        file = path.join(
            os.tmpdir(),
            `firmware-${process.pid}-${Date.now()}.json`
        );
        process.env.ECHO_FIRMWARE_MANIFEST = file;
        resetFirmwareCache();
    });

    afterEach(() => {
        delete process.env.ECHO_FIRMWARE_MANIFEST;
        resetFirmwareCache();
        if (fs.existsSync(file)) fs.unlinkSync(file);
    });

    it('reads the manifest from ECHO_FIRMWARE_MANIFEST', () => {
        fs.writeFileSync(file, JSON.stringify(manifest));
        expect(loadFirmwareManifest()).toMatchObject({
            devices: { 'echo-zero': { version: '1.0.0' } },
        });
    });

    it('returns null for a missing file', () => {
        expect(loadFirmwareManifest()).toBeNull();
    });

    it('returns null for malformed json', () => {
        fs.writeFileSync(file, '{ not json');
        expect(loadFirmwareManifest()).toBeNull();
    });

    it('returns null when the devices object is missing', () => {
        fs.writeFileSync(file, JSON.stringify({ generatedAt: 'now' }));
        expect(loadFirmwareManifest()).toBeNull();
    });

    it('re-reads the manifest when the file changes', () => {
        fs.writeFileSync(file, JSON.stringify(manifest));
        expect(loadFirmwareManifest()?.devices['echo-zero'].version).toBe(
            '1.0.0'
        );

        const changed = {
            ...manifest,
            devices: { ...manifest.devices, 'echo-zero': { version: '1.1.0' } },
        };
        // The cache is keyed by mtime: force a different one.
        fs.writeFileSync(file, JSON.stringify(changed));
        const future = new Date(Date.now() + 5000);
        fs.utimesSync(file, future, future);

        expect(loadFirmwareManifest()?.devices['echo-zero'].version).toBe(
            '1.1.0'
        );
    });
});

describe('firmware binaries', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-devices-'));
        process.env.ECHO_DEVICES_DIR = dir;
        resetFirmwareCache();
    });

    afterEach(() => {
        delete process.env.ECHO_DEVICES_DIR;
        delete process.env.ECHO_FIRMWARE_MANIFEST;
        resetFirmwareCache();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    /** Publish a manifest in the temporary `echo-devices` directory. */
    function publish(content: FirmwareManifest): void {
        fs.writeFileSync(
            path.join(dir, 'firmware.json'),
            JSON.stringify(content)
        );
    }

    it('reads the manifest from ECHO_DEVICES_DIR', () => {
        publish(manifest);
        expect(echoDevicesDir()).toBe(dir);
        expect(firmwareManifestPath()).toBe(path.join(dir, 'firmware.json'));
        expect(loadFirmwareManifest()?.devices['echo-zero'].version).toBe(
            '1.0.0'
        );
    });

    it('resolves a published binary inside the echo-devices directory', () => {
        expect(
            firmwareBinaryPath({
                version: '1.0.0',
                path: 'esp32s3/.pio/build/echo-zero/firmware.bin',
            })
        ).toBe(
            path.join(
                path.resolve(dir),
                'esp32s3/.pio/build/echo-zero/firmware.bin'
            )
        );
    });

    it('refuses a path that leaves the echo-devices directory', () => {
        expect(
            firmwareBinaryPath({ version: '1.0.0', path: '../secret.bin' })
        ).toBeNull();
        expect(
            firmwareBinaryPath({
                version: '1.0.0',
                path: path.resolve(dir, '..', 'secret.bin'),
            })
        ).toBeNull();
        expect(firmwareBinaryPath({ version: '1.0.0' })).toBeNull();
        expect(firmwareBinaryPath(null)).toBeNull();
    });

    it('serves the binary the manifest publishes for a type', () => {
        publish({
            devices: {
                'echo-zero': {
                    version: '1.0.0',
                    path: 'esp32s3/.pio/build/echo-zero/firmware.bin',
                },
                'echo-dashboard': {
                    version: '2.1.3',
                    path: 'esp32s3/.pio/build/echo-dashboard/firmware.bin',
                },
            },
        });

        const binary = resolveFirmwareBinary('echo-dashboard');
        expect(binary?.entry.version).toBe('2.1.3');
        expect(binary?.file).toBe(
            path.join(
                path.resolve(dir),
                'esp32s3/.pio/build/echo-dashboard/firmware.bin'
            )
        );
    });

    it('serves nothing for an unknown or unpublished type', () => {
        publish({ devices: { 'echo-zero': { version: '1.0.0' } } });

        // Not in the manifest at all (e.g. a variant with no OTA build).
        expect(resolveFirmwareBinary('echo-cook')).toBeNull();
        // A version without a binary has nothing to download.
        expect(resolveFirmwareBinary('echo-zero')).toBeNull();
        expect(resolveFirmwareBinary('')).toBeNull();
    });

    it('serves nothing without a manifest', () => {
        expect(resolveFirmwareBinary('echo-zero')).toBeNull();
    });
});
