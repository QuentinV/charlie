import dgram from 'dgram';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import wavHeader from '@wpdas/wave-header';
import vosk from 'vosk';

/**
 * DRAFT CODE
 **/

let audioBuffer = [];
let silenceCounter = 0;
const silenceLimit = 1;

function isSilent(buffer, rmsThreshold = 500) {
    let sumSquares = 0;
    const sampleCount = buffer.length / 2;

    for (let i = 0; i < buffer.length; i += 2) {
        const sample = buffer.readInt16LE(i);
        sumSquares += sample * sample;
    }

    const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
    // console.log('rms', rms);
    return rms < rmsThreshold;
}

/*
Vosk expects:
PCM 16-bit
Mono
Little-endian
8kHz or 16kHz sample rate
*/
vosk.setLogLevel(0);
const model = new vosk.Model('../vosk/fr-0.22');
const rec = new vosk.Recognizer({
    model,
    sampleRate: 16000,
});

function processBuffer(data, callback) {
    const time = Date.now();

    const silent = isSilent(data);
    if (!silent) {
        audioBuffer.push(data.slice(44));
        silenceCounter = 0;
        //console.log(wavHeader.readHeader(data));
        return;
    }

    if (silenceCounter < silenceLimit) {
        console.log('silence');
        silenceCounter++;
        audioBuffer.push(data.slice(44));
        return;
    }

    if (silenceCounter > silenceLimit) {
        return;
    }

    silenceCounter++;

    const buff = audioBuffer;
    audioBuffer = [];
    const rawAudio = Buffer.concat(buff);
    const header = wavHeader.generateHeader(rawAudio.length, {
        channels: 1,
        sampleRate: 48000,
        bitDepth: 16,
    });
    const finalWav = Buffer.concat([header, rawAudio]);
    console.log('final file');

    const ffmpeg = spawn(ffmpegPath, [
        '-f',
        'wav',
        '-i',
        'pipe:0',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-f',
        'wav',
        'pipe:1',
    ]);

    ffmpeg.stdin.write(finalWav);
    ffmpeg.stdin.end();

    ffmpeg.stdout.on('data', (stdout) => {
        rec.acceptWaveform(stdout);
    });

    ffmpeg.on('error', (e) => {
        console.log('error', e);
    });

    ffmpeg.on('close', async () => {
        const result = rec.finalResult();
        console.log('final result', result);
        console.log('elapsed time', Date.now() - time);
        callback?.(result);
    });
}

// Start UDP server
const server = dgram.createSocket('udp4');
server.on('message', async (data) => {
    processBuffer(data);
});
server.bind(12345);

// Start HTTP / Websocket server
const app = express();
app.use(express.json());
app.use(cors());

const port = 8080;
const httpserver = app.listen(port, () => {
    console.log(`Http server listening on port ${port}`);
});

const wss = new WebSocketServer({ httpserver });
wss.on('connection', (ws) => {
    ws.on('error', console.error);

    ws.on('message', async (data) => {
        processBuffer(data, (result) => {
            ws.send(JSON.stringify(result));
        });
    });
});
