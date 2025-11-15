import dgram from 'dgram';
import vosk from 'vosk';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { askDirect } from '../ai/ask';

vosk.setLogLevel(0);
const model = new vosk.Model('../vosk/fr-0.22');
const rec = new vosk.Recognizer({
    model,
    sampleRate: 8000,
});

let audioBuffer = [];

function getTextFromAudio(buffer): Promise<string> {
    return new Promise((res, rej) => {
        const ffmpeg = spawn(ffmpegPath, [
            '-f',
            's32le',
            '-ar',
            '8000',
            '-ac',
            '1',
            '-i',
            'pipe:0',
            '-filter:a',
            'volume=40.0,dynaudnorm=f=150:g=15',
            '-f',
            'wav',
            'pipe:1',
        ]);

        // '-filter:a', 'highpass=f=200,volume=4.0,dynaudnorm=f=150:g=15,afftdn=nf=-25'
        // '-filter:a', 'compand=attacks=0:decays=0:points=-80/-900|-50/-20|0/-10:gain=20' // This simulates automatic gain control (AGC), making quiet sounds louder and loud sounds softer:

        ffmpeg.stdin.write(Buffer.concat(buffer));
        ffmpeg.stdin.end();

        ffmpeg.stdout.on('data', (stdout) => {
            rec.acceptWaveform(stdout);
        });

        ffmpeg.on('error', (e) => {
            console.log('error', e);
            rej();
        });

        ffmpeg.on('close', async () => {
            const result = rec.finalResult();
            res(result?.text);
        });
    });
}

let timeout = null;
function resetTimeout() {
    clearTimeout(timeout);
    timeout = setTimeout(async () => {
        try {
            console.log('audio received');
            const text = await getTextFromAudio(audioBuffer);
            console.log('spoken text', text);
            const result = await askDirect(text);
            console.log(result);
        } finally {
            audioBuffer = [];
        }
    }, 1000);
}

// UDP Server
const port = 12345;
const server = dgram.createSocket('udp4');
server.on('message', async (data, rinfo) => {
    console.log(
        `receving audio from ${rinfo.address}:${rinfo.port} of size ${rinfo.size}`
    );
    resetTimeout();
    audioBuffer.push(data);
});

server.on('listening', () => {
    console.log(`Listening on port ${port}`);
});

server.bind(port);
