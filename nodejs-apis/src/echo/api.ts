import { RestApis } from '../types';
import fs from 'fs';
import { connectedEchos } from './listen';
import { cs } from '../core/db';
import {
    setServerIp,
    setWakeUpWordAccuracy,
    startOTA,
    updateDisplays,
} from './service';

const DIR = '../echo-devices';

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
            handler: async () => [...Object.keys(connectedEchos)],
        },
    },
    'echo/ota': {
        post: {
            handler: async ({ body }) => {
                const { ip } = body;
                await startOTA(ip);
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
    'echo/:ip/params': {
        get: {
            handler: async ({ params }) =>
                cs.echoSettings.findOne({ ip: params.ip.replaceAll('-', '.') }),
        },
        post: {
            handler: async ({ params, body }) => {
                const ip = params.ip.replaceAll('-', '.');
                const { serverIp, wakeWordAccuracy } = body;
                if (wakeWordAccuracy) {
                    await setWakeUpWordAccuracy(ip, wakeWordAccuracy);
                }
                if (serverIp) {
                    await setServerIp(ip, serverIp);
                }
                await cs.echoSettings.updateOne(
                    { ip },
                    { $set: { serverIp, wakeWordAccuracy } },
                    { upsert: true }
                );
            },
        },
    },
    'echo/:ip/screens': {
        post: {
            handler: async ({ params, body }) => {
                const ip = params.ip.replaceAll('-', '.');
                const { refreshTime, screens } = body;
                await cs.echoSettings.updateOne(
                    { ip },
                    { $set: { screens: { refreshTime, screens } } },
                    { upsert: true }
                );
            },
        },
        get: {
            handler: async ({ params, body }) => {
                const ip = params.ip.replaceAll('-', '.');
                return (await cs.echoSettings.findOne({ ip }))?.screens ?? {};
            },
        },
    },
};

export default routes;
