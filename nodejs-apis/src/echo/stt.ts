import 'dotenv/config';
import WebSocket from 'ws';
import { saveWavWithRotation } from './logs';

function trimEnd500ms(buffer) {
    const bytesToRemove = 16000 * 1.8; // 0.5s at 16kHz mono PCM16
    if (buffer.length <= bytesToRemove) return buffer;
    return buffer.slice(0, buffer.length - bytesToRemove);
}

export interface SttOptions {
    record?: boolean;
    trimEnd?: boolean;
    key?: string;
}

let wsCache = {};
async function getWs(onResult: (text: string) => void, key: string) {
    if (wsCache[key]) {
        wsCache[key].onResult = onResult;
        return wsCache[key];
    }
    return new Promise((res, rej) => {
        const ws = new WebSocket(
            `ws://${process.env.AI_AGENTS_HOST}/stt/${key}/stream`
        );

        ws.on('open', () => {
            wsCache[key] = ws;
            wsCache[key].onResult = onResult;
            res(ws);

            ws.on('message', (msg) => {
                const event = JSON.parse(msg.toString());
                if (event.type === 'result') {
                    wsCache[key]?.onResult(event.data.text);
                }
            });
        });

        ws.on('error', (e) => {
            console.log('ws', e);
            rej();
        });

        ws.on('close', () => {
            delete wsCache[key];
        });
    });
}

async function sendChunk(
    buffer: Buffer<ArrayBuffer>,
    key: string
): Promise<string> {
    return new Promise(async (res, rej) => {
        const ws = await getWs((text) => {
            res(text);
        }, key);

        ws.send(buffer);
        ws.send('__END__');
    });
}

export function stt(buffer: any[], options?: SttOptions): Promise<string> {
    if (options?.record) {
        saveWavWithRotation(Buffer.concat(buffer));
    }

    let buff = Buffer.concat([
        Buffer.alloc(16000 * 2 * 0.3),
        Buffer.concat(buffer),
    ]);

    if (options.trimEnd) {
        buff = trimEnd500ms(buff);
    }

    return sendChunk(
        buff,
        options?.key ?? process.env.DEFAULT_STT_MODEL ?? 'vosk'
    );
}
