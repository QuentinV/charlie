import { RestApis } from '../types';
import fs from 'fs';
import { connectedEchos, getEchoMacByIp, resolveConnectedIp } from './listen';
import {
    askVersions,
    setServerIp,
    setWakeUpWordAccuracy,
    startOTA,
} from './service';
import {
    decodeEchoId,
    encodeEchoId,
    findEchoSettingsById,
    findEchoSettingsByIp,
    normalizeIp,
    saveEchoSettings,
} from './identity';
import { checkFirmware, loadFirmwareManifest } from './firmware';
import {
    getUiBundle,
    getUiRevision,
    publishUiBundle,
    rollbackUiBundle,
} from './ui/store';
import { resolveVars } from './ui/vars';
import { runUiAction } from './ui/actions';

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

/**
 * Canonical MAC of a device from the `:id` of a url. The route id is the
 * encoded form (`aa-bb-cc-dd-ee-ff`); an ip id is accepted as a fallback for
 * firmware that does not report a MAC yet.
 */
function deviceMac(id: string): string {
    const { mac, ip } = decodeEchoId(id);
    return mac ?? normalizeIp(ip ?? '');
}

/**
 * Variable paths of a `/ui/vars` request. Accepts the repeated form the device
 * uses (`?p=a&p=b`) and a comma-separated list (`?p=a,b`) for manual calls.
 */
function parseVarPaths(query: any): string[] {
    const raw = query?.p ?? query?.paths ?? query?.path;
    const list = Array.isArray(raw) ? raw : raw ? String(raw).split(',') : [];
    return list.map((value: any) => String(value).trim()).filter(Boolean);
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

    /* ------------------------------------------------------ screen bundles */
    /*
     * The device pulls its UI from here (contract: src/echo/ui/schema.ts).
     * Nothing is pushed over the WebSocket: the device asks for the revision,
     * downloads the bundle when the hash changed, resolves its variables in
     * batches and runs every action locally. `call` actions come back to
     * `/ui/actions` — that is the only inbound traffic.
     */

    // Cheap poll: `{rev, hash, updatedAt}`, or rev 0 when nothing was published.
    'echo/:id/ui/rev': {
        get: {
            handler: async ({ params }) => {
                const revision = await getUiRevision(deviceMac(params.id));
                return revision ?? { rev: 0, hash: null };
            },
        },
    },
    // The bundle itself. ETag = its hash, so a device that already has this
    // revision gets a 304 and keeps its cached copy.
    'echo/:id/ui': {
        get: {
            fullHandler: async ({ params, headers }, res) => {
                const document = await getUiBundle(deviceMac(params.id));
                if (!document) {
                    return res.sendStatus(404);
                }
                const etag = `"${document.hash}"`;
                res.setHeader('ETag', etag);
                res.setHeader('Cache-Control', 'no-cache');
                if (headers['if-none-match'] === etag) {
                    return res.sendStatus(304);
                }
                res.json(document.bundle);
            },
        },
        // Publish (or replace) the bundle. Validation failures come back as
        // `{ok:false, issues:[…]}` so the caller can show them.
        put: {
            handler: async ({ params, body }) =>
                publishUiBundle(deviceMac(params.id), body),
        },
    },
    'echo/:id/ui/rollback': {
        post: {
            handler: async ({ params }) => {
                const restored = await rollbackUiBundle(deviceMac(params.id));
                return restored ?? { error: 'no previous revision' };
            },
        },
    },
    // Batch variable resolution: `?p=external.devices.Chambre.state&p=…`.
    'echo/:id/ui/vars': {
        get: {
            handler: async ({ params, query }) => {
                const paths = parseVarPaths(query);
                if (paths.length === 0) {
                    return { values: {}, missing: [], unsupported: [] };
                }
                const resolved = await resolveVars(paths);
                const revision = await getUiRevision(deviceMac(params.id));
                return { ...resolved, rev: revision?.rev ?? 0 };
            },
        },
    },
    // `call` actions from the device. Always answers 200 with `{ok,…}` so the
    // device can log a failure without treating it as a transport error.
    'echo/:id/ui/actions': {
        post: {
            handler: async ({ params, body, ip }) => {
                const { action, params: actionParams } = body ?? {};
                if (!action) {
                    return { ok: false, error: 'missing action' };
                }
                const mac = deviceMac(params.id);
                const revision = await getUiRevision(mac);
                return runUiAction(action, actionParams, {
                    mac,
                    ip: ip ?? resolveConnectedIp(params.id),
                    rev: revision?.rev,
                });
            },
        },
    },
};

export default routes;
