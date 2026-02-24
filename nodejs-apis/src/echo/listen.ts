import { WebSocketServer } from 'ws';
import { stt } from './stt';
import { tts } from '../ai/tts';
import { ask } from '../ai/flow';
import { logEcho } from './logs';

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
        log('Device connected');

        ws.on('ping', () => {
            log('ping');
        });

        ws.on('pong', () => {
            log('pong');
        });

        let audioBuffer = [];
        let audioBufferWakeword = [];
        let status = '';
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
                audioBuffer = [];
                log('wake word start');
                return;
            }

            if (m === 'WAKEWORD_END') {
                status = 'wakeword_pending';
                const res = await stt(audioBufferWakeword, { record: true });
                status = res !== 'charlie' ? 'cancel' : 'ok';
                log(`wakeword received: ${res} => ${status}`);
                return;
            }

            if (m === 'END') {
                while (true) {
                    if (status === 'cancel') {
                        log(`end received cancel`);
                        audioBuffer = [];
                        return;
                    }

                    if (status === 'wakeword_pending') {
                        await new Promise((r) => setTimeout(r, 100));
                        continue;
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

                    return;
                }
            }
        });
    });
}
