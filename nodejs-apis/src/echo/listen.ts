import { WebSocketServer } from 'ws';
import { stt } from './stt';
import { tts } from '../ai/tts';
import { ask } from '../ai/flow';
import { logEcho } from './logs';

const VERIFY_TEXT = ['charlie, ', 'charlie ', 'charlie. '];

export const connectedEchos = {};

function sendPCMInChunks(ws, buffer, chunkSize = 4096) {
    for (let i = 0; i < buffer.length; i += chunkSize) {
        const chunk = buffer.slice(i, i + chunkSize);
        ws.send(chunk, { binary: true });
    }
}

function verify(text: string) {
    const t = text.toLowerCase();
    for (let i = 0; i < VERIFY_TEXT.length; ++i) {
        if (t.startsWith(VERIFY_TEXT[i])) {
            return text.substring(VERIFY_TEXT[i].length);
        }
    }
    return false;
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
        ws.on('error', (err) => {
            log('WebSocket error:' + err.message);
            delete connectedEchos[ip];
        });

        ws.on('close', () => {
            delete connectedEchos[ip];
        });

        ws.on('message', async (msg, isBinary) => {
            if (isBinary) {
                audioBuffer.push(msg);
                return;
            }

            const m = msg.toString();
            if (m === 'start') {
                log('start rec');
                audioBuffer = [];
                return;
            }

            if (m === 'end') {
                try {
                    log('process');
                    const text = await stt(audioBuffer, {
                        record: true,
                        trimEnd: false,
                    });

                    console.log('received text', text);
                    if (text && typeof text === 'string') {
                        log(`text = ${text}`);
                        const valid = verify(text);
                        log(`text verified = ${valid}`);

                        if (valid) {
                            const result = await ask(valid);
                            log(`result = ${result}`);

                            ws.send(
                                result === null
                                    ? 'Comprends pas'
                                    : result === false
                                      ? `Pas possible`
                                      : 'Ok!'
                            );

                            if (typeof result === 'string') {
                                const resultAudio = await tts({ text: result });
                                sendPCMInChunks(ws, Buffer.from(resultAudio));
                            }
                        }
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
