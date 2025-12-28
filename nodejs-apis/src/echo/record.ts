import dgram from 'dgram';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

let i = 0;

const buffers = [[], []];
let activeBuffer = 0;

setTimeout(() => {
    console.log('exec');
    setInterval(() => {
        console.log('recording to file');
        const ab = activeBuffer;
        activeBuffer = activeBuffer === 0 ? 1 : 0;

        const ffmpeg = spawn(ffmpegPath, [
            '-f',
            's16le', // s32le
            '-ar',
            '16000', // 8000
            '-ac',
            '1',
            '-i',
            'pipe:0',
            '-f',
            'wav',
            `demo/stop-${i++}.wav`,
        ]);

        ffmpeg.stdin.write(Buffer.concat(buffers[ab]));
        ffmpeg.stdin.end();
        buffers[ab] = [];
    }, 1000);
}, 5000);

// UDP Server for audio
const PORT_UDP_AUDIO = 9303;
const audioServer = dgram.createSocket('udp4');
audioServer.on('message', async (data) => {
    buffers[activeBuffer].push(data);
});

audioServer.on('listening', () => {
    console.log(`Listening audio data on port ${PORT_UDP_AUDIO}`);
});

audioServer.bind(PORT_UDP_AUDIO);
