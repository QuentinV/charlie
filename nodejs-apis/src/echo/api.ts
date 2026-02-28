import { RestApis } from '../types';
import fs from 'fs';
import { connectedEchos } from './listen';

const DIR = '../echo-devices';

const routes: RestApis = {
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
                connectedEchos[ip]?.send('OTA');
            },
        },
    },
};

export default routes;
