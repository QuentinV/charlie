import { spawn } from 'child_process';
import WebSocket from 'ws';
import ffmpegPath from 'ffmpeg-static';
import { saveWavWithRotation } from './logs';

export function stt(buffer): Promise<string> {
    saveWavWithRotation(Buffer.concat(buffer));

    return new Promise(async (res, rej) => {
        const ws = new WebSocket(
            `ws://${process.env.AI_AGENTS_HOST}/stt/stream`
        );

        ws.on('open', () => {
            /*const ffmpeg = spawn(ffmpegPath, [
                '-f',
                's16le', // s32le
                '-ar',
                '16000', // 8000
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

            ffmpeg.stdin.write(Buffer.concat(buffer));
            ffmpeg.stdin.end();

            ffmpeg.stdout.on('data', (chunk) => {
                ws.send(chunk);
            });

            ffmpeg.on('error', (e) => {
                console.log('error', e);
                rej();
            });

            ffmpeg.on('close', async () => {
                ws.send('__END__');
            });*/

            ws.send(Buffer.concat(buffer));
            ws.send('__END__');

            ws.on('message', (msg) => {
                const event = JSON.parse(msg.toString());

                /*if (event.type === 'partial') {
                    console.log('Partial:', event.data.partial);
                }*/

                if (event.type === 'result') {
                    ws.close();
                    res(event.data.text);
                }
            });
        });

        ws.on('error', (e) => {
            console.log('ws', e);
            rej();
        });
    });
}

// '-filter:a', 'highpass=f=200,volume=4.0,dynaudnorm=f=150:g=15,afftdn=nf=-25'
// '-filter:a', 'compand=attacks=0:decays=0:points=-80/-900|-50/-20|0/-10:gain=20' // This simulates automatic gain control (AGC), making quiet sounds louder and loud sounds softer:
