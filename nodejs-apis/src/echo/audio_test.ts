import dgram from 'dgram';
import { askDirect } from '../ai/llm';
import { WebSocketServer } from 'ws';
import { stt } from './stt';
import { tts } from '../ai/tts';
import { v4 as uuidV4 } from 'uuid';
import fs from 'fs';

function pcmToWav(
    pcmBuffer,
    sampleRate = 16000,
    numChannels = 1,
    bitsPerSample = 16
) {
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const header = Buffer.alloc(44);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmBuffer.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmBuffer.length, 40);

    return Buffer.concat([header, pcmBuffer]);
}

function sendPCMInChunks(ws, buffer, chunkSize = 4096) {
    for (let i = 0; i < buffer.length; i += chunkSize) {
        const chunk = buffer.slice(i, i + chunkSize);
        ws.send(chunk, { binary: true });
    }
}

export function setupEchoListen() {
    const wss = new WebSocketServer({ port: 9303, path: '/ws/echo' });

    wss.on('connection', (ws, req) => {
        console.log('[ECHO] Device connected');
        let audioBuffer = [];

        if (process.env.ECHO_CONTINOUS_AUDIO_TEST === 'true') {
            setInterval(
                () => {
                    console.log('audio received');
                    const uuid = uuidV4();
                    const wav = pcmToWav(Buffer.concat(audioBuffer));
                    console.log('storing to ', uuid);
                    fs.writeFileSync(`files/${uuid}.wav`, wav);
                    audioBuffer = [];
                },
                5 * 60 * 1000
            );
        }

        ws.on('message', async (msg, isBinary) => {
            if (isBinary) {
                audioBuffer.push(msg);
                return;
            }

            if (
                process.env.ECHO_CONTINOUS_AUDIO_TEST !== 'true' &&
                msg.toString() === 'END'
            ) {
                try {
                    console.log('audio received');
                    if (process.env.ECHO_AUDIO_TEST === 'true') {
                        const uuid = uuidV4();
                        const wav = pcmToWav(Buffer.concat(audioBuffer));
                        console.log('storing to ', uuid);
                        fs.writeFileSync(`files/${uuid}.wav`, wav);
                        return;
                    }

                    const text = await stt(audioBuffer);
                    console.log('spoken text', text);
                    const result = await askDirect(text);
                    console.log('result', result);
                    const resultAudio = await tts({ text: result });
                    sendPCMInChunks(ws, Buffer.from(resultAudio));
                } catch (e) {
                    console.log(e);
                } finally {
                    audioBuffer = [];
                }
            }
        });
    });
}
