import 'dotenv/config';
import { WebSocketServer } from 'ws';
import { stt } from './stt';
import { tts } from '../ai/tts';
import { v4 as uuidV4 } from 'uuid';
import fs from 'fs';
import { ask } from '../ai/flow';
import { pcmToWav } from './utils';

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
            setInterval(() => {
                console.log('audio received');
                const uuid = uuidV4();
                const wav = pcmToWav(Buffer.concat(audioBuffer));
                console.log('storing to ', uuid);
                fs.writeFileSync(`files/${uuid}.wav`, wav);
                audioBuffer = [];
            }, 5 * 1000);
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

                    const text = await stt(audioBuffer, false);
                    console.log('spoken text', text);
                    const result = await ask(text);
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

setupEchoListen();
