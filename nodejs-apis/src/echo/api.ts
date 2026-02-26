import { RestApis } from '../types';
import fs from 'fs';

const DIR = '../echo-devices';

const routes: RestApis = {
    'echo/:echoType/latest/firmware.bin': {
        get: {
            fullHandler: async ({ params }, res) => {
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader(
                    'Content-Disposition',
                    'attachment; filename=firmware.bin'
                );

                const stream = fs.createReadStream(
                    `${DIR}/${params.echoType}/.pio/build/esp32-s3-wroom-n16r8/firmware.bin`
                );

                stream.pipe(res);
            },
            description: 'Download firmware file',
        },
    },
};

export default routes;
