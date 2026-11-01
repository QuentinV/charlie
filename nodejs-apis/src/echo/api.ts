import { RestApis } from '../types';
import fs from 'fs';
import { connectedEchos, getEchoMacByIp, resolveConnectedIp } from './listen';
import {
    askVersions,
    setServerIp,
    setWakeUpWordAccuracy,
    startOTA,
    updateDisplays,
} from './service';
import {
    encodeEchoId,
    findEchoSettingsById,
    findEchoSettingsByIp,
    saveEchoSettings,
} from './identity';
import { checkFirmware, loadFirmwareManifest } from './firmware';

const DIR = '../echo-devices';

/**
 * Address to send a live command to, from a settings id: the ip of the
 * connected socket when the device is online, the ip stored in its settings
 * otherwise (sending to a disconnected device is a no-op either way).
 */
async function commandIp(id: string): Promise<string | undefined> {
    const live = resolveConnectedIp(id);
    if (live) return live;
    return (await findEchoSettingsById(id))?.ip;
}

const routes: RestApis = {
    'echo/:echoType/latest/firmware.bin': {
        get: {
            fullHandler: async ({ params }, res) => {
                const filePath = `${DIR}/.pio/build/${params.echoType}/firmware.bin`;

                fs.stat(filePath, (err, stats) => {
                    if (err) {
                        console.error(err);
                        return res.sendStatus(404);
                    }

                    res.setHeader('Content-Type', 'application/octet-stream');
                    res.setHeader(
                        'Content-Disposition',
                        'attachment; filename=firmware.bin'
                    );
                    res.setHeader('Content-Length', stats.size);

                    const stream = fs.createReadStream(filePath);
                    stream.pipe(res);
                });
            },
            description: 'Download firmware file',
        },
    },
    echo: {
        get: {
            handler: async () => {
                // One entry per connected device, addressed by its canonical id
                // (the MAC it reports, the ip only for firmware without one).
                const manifest = loadFirmwareManifest();
                const ips = Object.keys(connectedEchos);
                const settings = await Promise.all(
                    ips.map((ip) => findEchoSettingsByIp(ip, getEchoMacByIp(ip)))
                );
                return ips.map((ip, index) => {
                    const doc = settings[index];
                    const mac = doc?.mac ?? getEchoMacByIp(ip);
                    const deviceType = doc?.deviceType ?? doc?.versions?.type;
                    return {
                        id: encodeEchoId(mac ?? ip),
                        ip,
                        mac,
                        deviceType,
                        versions: doc?.versions,
                        lastSeen: doc?.lastSeen,
                        ota: doc?.ota,
                        firmware: checkFirmware(
                            manifest,
                            deviceType,
                            doc?.versions?.device
                        ),
                    };
                });
            },
        },
    },
    'echo/ota': {
        post: {
            handler: async ({ body }) => {
                const { id, ip, reset } = body ?? {};
                if (!id && !ip) return;
                const targetId = id ?? ip;

                // A manual request clears the "stuck" flag so the next check
                // (automatic or not) retries a device the server gave up on.
                if (reset) {
                    const doc = await findEchoSettingsById(targetId);
                    if (doc?.ota) {
                        await saveEchoSettings(targetId, {
                            ota: { ...doc.ota, attempts: 0, stuck: false },
                        });
                    }
                }

                const target = await commandIp(targetId);
                if (!target) return;
                await startOTA(target);
            },
        },
    },
    // Firmware status of a device, computed from the published manifest and
    // the versions it reported.
    'echo/:id/firmware': {
        get: {
            handler: async ({ params }) => {
                const doc = await findEchoSettingsById(params.id);
                if (!doc) return;
                const deviceType = doc.deviceType ?? doc.versions?.type;
                return {
                    id: params.id,
                    ip: doc.ip,
                    mac: doc.mac,
                    deviceType,
                    versions: doc.versions,
                    ota: doc.ota,
                    firmware: checkFirmware(
                        loadFirmwareManifest(),
                        deviceType,
                        doc.versions?.device
                    ),
                };
            },
        },
    },
    // Ask the device to report its versions (and its MAC) on demand.
    'echo/:id/versions': {
        post: {
            handler: async ({ params }) => {
                const target = await commandIp(params.id);
                if (target) await askVersions(target);
            },
        },
    },
    'echo/changelogs': {
        get: {
            fullHandler: async (_, res) => {
                const filePath = `${DIR}/changelog.json`;
                fs.stat(filePath, (err, stats) => {
                    if (err) {
                        console.error(err);
                        return res.sendStatus(404);
                    }

                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader(
                        'Content-Disposition',
                        'attachment; filename=changelog.json'
                    );
                    res.setHeader('Content-Length', stats.size);

                    const stream = fs.createReadStream(filePath);
                    stream.pipe(res);
                });
            },
        },
    },
    // The settings live under the id of the device: its MAC once it has
    // reported one, so they follow it when DHCP changes its address.
    'echo/:id/params': {
        get: {
            handler: async ({ params }) => findEchoSettingsById(params.id),
        },
        post: {
            handler: async ({ params, body }) => {
                const { serverIp, wakeWordAccuracy } = body;
                const target = await commandIp(params.id);
                if (target) {
                    if (wakeWordAccuracy) {
                        await setWakeUpWordAccuracy(target, wakeWordAccuracy);
                    }
                    if (serverIp) {
                        await setServerIp(target, serverIp);
                    }
                }
                await saveEchoSettings(params.id, {
                    serverIp,
                    wakeWordAccuracy,
                });
            },
        },
    },
    'echo/:id/screens': {
        post: {
            handler: async ({ params, body }) => {
                const { refreshTime, screens } = body;
                await saveEchoSettings(params.id, {
                    screens: { refreshTime, screens },
                });
            },
        },
        get: {
            handler: async ({ params }) =>
                (await findEchoSettingsById(params.id))?.screens ?? {},
        },
    },
};

export default routes;
