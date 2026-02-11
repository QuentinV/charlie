import { WebSocketServer } from 'ws';
import { stt } from './stt';
import { tts } from '../ai/tts';
import { ask } from '../ai/flow';
import fs from 'fs';

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
        ws.on('message', async (msg, isBinary) => {
            if (isBinary) {
                audioBuffer.push(msg);
                return;
            }

            if (msg.toString() === 'END') {
                try {
                    console.log('audio received');
                    const text = await stt(audioBuffer);
                    console.log('spoken text', text);
                    const result = await ask(text);
                    console.log('result', result);
                    ws.send(result ? 'Ok! :-)' : ':-(');
                    if (result) {
                        const resultAudio = await tts({ text: result });
                        sendPCMInChunks(ws, Buffer.from(resultAudio));
                    }
                } catch (e) {
                    console.log(e);
                } finally {
                    audioBuffer = [];
                }
            }
        });
    });
}
