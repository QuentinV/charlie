import { RestApis } from '../types';
import fs from 'fs';
import { connectedEchos } from './listen';

const DIR = '../echo-devices';

const routes: RestApis = {
    // TODO firmware.bin isn't enough, 3 files requires, should rework the path
    'echo/:echoType/latest/firmware.bin': {
        get: {
            fullHandler: async ({ params }, res) => {
                const filePath = `${DIR}/${params.echoType}/.pio/build/esp32-s3-wroom-n16r8/firmware.bin`;

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
                await connectedEchos[ip]?.send('OTA');
            },
        },
    },
    'echo/params': {
        post: {
            handler: async ({ body }) => {
                const { ip, wakeWordAccuracy } = body;
                if (ip) {
                    await connectedEchos[ip]?.send(`setServerIp:${ip}`);
                }
                if (wakeWordAccuracy) {
                    await connectedEchos[ip]?.send(
                        `setWakeUpWordAccuracy:${wakeWordAccuracy}`
                    );
                }
            },
        },
    },
};

export default routes;
