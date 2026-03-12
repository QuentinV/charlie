import { WebSocketServer } from 'ws';
import { stt } from './stt';
import { tts } from '../ai/tts';
import { ask } from '../ai/flow';
import { logEcho } from './logs';

export const connectedEchos = {};

function sendPCMInChunks(ws, buffer, chunkSize = 4096) {
    for (let i = 0; i < buffer.length; i += chunkSize) {
        const chunk = buffer.slice(i, i + chunkSize);
        ws.send(chunk, { binary: true });
    }
}

export function setupEchoListen() {
    const wss = new WebSocketServer({ port: 9303, path: '/ws/echo' });

    wss.on('connection', (ws, req) => {
        const ip = req.socket.remoteAddress;
        const log = (message: string) => logEcho(ip, message);
        connectedEchos[ip] = ws;
        log('Device connected');

        //ws.on('ping', () => {
        //    log('ping');
        //});;

        let audioBuffer = [];
        let audioBufferWakeword = [];
        let status = '';
        ws.on('error', (err) => {
            log('WebSocket error:' + err.message);
            delete connectedEchos[ip];
        });

        ws.on('close', () => {
            delete connectedEchos[ip];
        });

        ws.on('message', async (msg, isBinary) => {
            if (isBinary) {
                (status === 'wakeword'
                    ? audioBufferWakeword
                    : audioBuffer
                ).push(msg);
                return;
            }

            const m = msg.toString();
            if (m === 'start-mic-capture') {
                log('start mic capture');
                return;
            }

            if (m === 'WAKEWORD_START') {
                status = 'wakeword';
                audioBufferWakeword = [];
                log('wake word start');
                return;
            }

            if (m === 'WAKEWORD_END') {
                status = 'wakeword_pending';
                const res = (await stt(audioBufferWakeword, { record: true }))
                    ?.toLowerCase()
                    ?.replace('.', '');
                status = res !== 'charlie' ? 'cancel' : 'ok';
                log(`wakeword received: ${res} => ${status}`);
                if (status === 'cancel') {
                    log(`end received cancel`);
                    audioBuffer = [];
                    return;
                }
                try {
                    log('audio received');
                    const text = await stt(audioBuffer, {
                        record: true,
                        trimEnd: true,
                    });
                    log(`spoken text = ${text}`);
                    const result = await ask(text);
                    log(`result = ${result}`);
                    ws.send(result ? 'Ok! :-)' : ':-(');
                    if (result) {
                        const resultAudio = await tts({ text: result });
                        sendPCMInChunks(ws, Buffer.from(resultAudio));
                    }
                } catch (e) {
                    console.log(e);
                    log(JSON.stringify(e));
                } finally {
                    audioBuffer = [];
                }
            }
        });
    });
}
