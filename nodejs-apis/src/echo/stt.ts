import 'dotenv/config';
import { spawn } from 'child_process';
import WebSocket from 'ws';
import ffmpegPath from 'ffmpeg-static';
import { saveWavWithRotation } from './logs';

function normalizePcmChunks(chunks, targetSize = 6400) {
    const input = Buffer.concat(chunks);
    const frames = [];

    let offset = 0;
    while (offset + targetSize <= input.length) {
        frames.push(input.slice(offset, offset + targetSize));
        offset += targetSize;
    }

    // Keep leftover for next batch (optional)
    const leftover = input.slice(offset);

    return { frames, leftover };
}

function trimEnd500ms(buffer) {
    const bytesToRemove = 16000 * 1.8; // 0.5s at 16kHz mono PCM16
    if (buffer.length <= bytesToRemove) return buffer;
    return buffer.slice(0, buffer.length - bytesToRemove);
}

export function stt(buffer: any[], record: boolean): Promise<string> {
    if (record) {
        saveWavWithRotation(Buffer.concat(buffer));
    }

    let paddedBuffer = Buffer.concat([
        Buffer.alloc(16000 * 2 * 0.3),
        Buffer.concat(buffer),
    ]);

    paddedBuffer = trimEnd500ms(paddedBuffer);

    return new Promise(async (res, rej) => {
        const ws = new WebSocket(
            `ws://${process.env.AI_AGENTS_HOST}/stt/stream`
        );

        ws.on('open', () => {
            const ffmpeg = spawn(ffmpegPath, [
                '-f',
                's16le',
                '-ar',
                '16000',
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

            ffmpeg.stdin.write(paddedBuffer);
            ffmpeg.stdin.end();

            let chunks = [];
            ffmpeg.stdout.on('data', (chunk) => {
                //console.log(chunk.length);
                chunks.push(chunk);
                ws.send(chunk);
                //sendToSttServer(chunk);
            });

            ffmpeg.on('error', (e) => {
                console.log('error', e);
                rej();
            });

            ffmpeg.on('close', async () => {
                saveWavWithRotation(Buffer.concat(chunks));
                ws.send('__END__');
            });

            ws.on('message', (msg) => {
                const event = JSON.parse(msg.toString());

                /*if (event.type === 'partialChunk') {
                    console.log('Partial chunk:', event);
                }

                if (event.type === 'partialText') {
                    console.log('Partial text:', event);
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

/*
let leftover = Buffer.alloc(0);
        function sendToSttServer(rawChunk) {
            const { frames, leftover: newLeftover } = normalizePcmChunks(
                [leftover, rawChunk],
                6400
            );

            leftover = newLeftover;

            for (const frame of frames) {
                ws.send(frame);
            }
        }
*/

//   'volume=40.0,dynaudnorm=f=150:g=15,asetrate=15500,aresample=16000',
//'volume=40.0,dynaudnorm=f=150:g=15,atempo=0.6,aresample=16000',
//'afftdn=nf=-25,acompressor=threshold=-30dB:ratio=3:attack=5:release=50,aresample=16000:resampler=soxr',
//'volume=40.0,dynaudnorm=f=150:g=15,aresample=16000:resampler=soxr',
// "firequalizer=gain='if(gte(f,55),0,-INF)+if(lte(f,14500),0,-INF)',volume=volume=30dB,afftdn=nr=30:nf=-30:gs=7:tn=0,dynaudnorm=p=1/sqrt(2):m=100:s=12",

// '-filter:a', 'highpass=f=200,volume=4.0,dynaudnorm=f=150:g=15,afftdn=nf=-25'
// '-filter:a', 'compand=attacks=0:decays=0:points=-80/-900|-50/-20|0/-10:gain=20' // This simulates automatic gain control (AGC), making quiet sounds louder and loud sounds softer:
//                 'volume=40.0,dynaudnorm=f=150:g=15',

/*

   //`afftdn=nf=-20, acompressor=threshold=-25dB:ratio=4:attack=5:release=50, loudnorm`,
                //'-filter:a',
                //'compand=attacks=0:decays=0:points=-80/-900|-50/-20|0/-10:gain=20',

ffmpeg -f s16le -ar 16000 -ac 1 -i input.pcm \
-af "afftdn=nf=-20, acompressor=threshold=-25dB:ratio=4:attack=5:release=50, loudnorm" \
-f s16le -acodec pcm_s16le output.pcm

            */
