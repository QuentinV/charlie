import 'dotenv/config';
import WebSocket from 'ws';
import { saveWavWithRotation } from './logs';

const host = process.env.STT_HOST ?? 'asr:5000';

export interface SttOptions {
    record?: boolean;
    trimEnd?: boolean;
}

let wsCache: any = null;
async function getWs(onResult: (text: string | boolean) => void) {
    if (wsCache) {
        wsCache.onResult = onResult;
        return wsCache;
    }
    return new Promise((res, rej) => {
        const ws = new WebSocket(`ws://${host}`, 'qwen-protocol');

        ws.on('open', () => {
            wsCache = ws;
            wsCache.onResult = onResult;
            res(ws);
        });

        ws.on('message', (msg) => {
            wsCache?.onResult(msg.toString());
        });

        ws.on('error', (e) => {
            console.log('ws', e);
            rej();
        });

        ws.on('close', () => {
            wsCache = null;
        });
    });
}

async function sendChunk(buffer: Buffer<ArrayBuffer>): Promise<string | false> {
    return new Promise(async (res, rej) => {
        const ws = await getWs((text) => {
            res(text as any);
        });

        ws.send(buffer);
    });
}

export async function stt(
    buffer: any[],
    options?: SttOptions
): Promise<string | boolean> {
    if (options?.record) {
        saveWavWithRotation(Buffer.concat(buffer));
    }

    return sendChunk(Buffer.concat(buffer));
}
