import 'dotenv/config';
import { saveWavWithRotation } from './logs';
import net from 'net';

const sttFullHost = process.env.STT_HOST ?? 'asr:10300';
const host = sttFullHost.substring(0, sttFullHost.indexOf(':'));
const port = Number(sttFullHost.substring(sttFullHost.indexOf(':') + 1));

export interface SttOptions {
    record?: boolean;
}

async function sendChunk(buff: Buffer<ArrayBuffer>): Promise<string | false> {
    return new Promise(async (res, rej) => {
        const client = new net.Socket();

        client.connect(port, host, () => {
            const transcribeHeader =
                JSON.stringify({
                    type: 'transcribe',
                    data: { language: 'fr' },
                }) + '\n';
            client.write(transcribeHeader);

            // Send PCM audio in 30ms chunks (960 bytes at 16kHz 16-bit)
            const chunkSize = 960;
            for (let offset = 0; offset < buff.length; offset += chunkSize) {
                const chunk = buff.subarray(offset, offset + chunkSize);

                const audioChunkHeader =
                    JSON.stringify({
                        type: 'audio-chunk',
                        data: { rate: 16000, width: 2, channels: 1 },
                        payload_length: chunk.length,
                    }) + '\n';

                client.write(audioChunkHeader);
                client.write(chunk);
            }

            // Send 'audio-stop' event
            const audioStopHeader =
                JSON.stringify({
                    type: 'audio-stop',
                    data: {},
                }) + '\n';
            client.write(audioStopHeader);
        });

        // --- Wyoming Protocol Stream Parser State Machine ---
        let buffer = Buffer.alloc(0);
        let state = 'HEADER';
        let currentHeader: any = null;
        let eventData: any = null;

        client.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            processBuffer();
        });

        function processBuffer() {
            while (true) {
                if (state === 'HEADER') {
                    const newlineIndex = buffer.indexOf('\n');
                    if (newlineIndex === -1) break; // Wait for full newline-terminated JSON header

                    const headerLine = buffer
                        .subarray(0, newlineIndex)
                        .toString('utf8');
                    buffer = buffer.subarray(newlineIndex + 1);

                    try {
                        currentHeader = JSON.parse(headerLine);
                    } catch (e) {
                        console.error(
                            'Failed to parse JSON header:',
                            headerLine
                        );
                        break;
                    }

                    eventData = currentHeader.data || null;
                    const dataLength = currentHeader.data_length || 0;
                    const payloadLength = currentHeader.payload_length || 0;

                    if (dataLength > 0) {
                        state = 'DATA';
                    } else if (payloadLength > 0) {
                        state = 'PAYLOAD';
                    } else {
                        emitEvent(currentHeader, eventData);
                        state = 'HEADER';
                    }
                }

                if (state === 'DATA') {
                    const dataLength = currentHeader.data_length || 0;
                    if (buffer.length < dataLength) break; // Wait for complete data buffer

                    const dataBytes = buffer.subarray(0, dataLength);
                    buffer = buffer.subarray(dataLength);

                    try {
                        eventData = JSON.parse(dataBytes.toString('utf8'));
                    } catch (e) {
                        console.error(
                            'Failed to parse JSON payload:',
                            dataBytes.toString('utf8')
                        );
                    }

                    const payloadLength = currentHeader.payload_length || 0;
                    if (payloadLength > 0) {
                        state = 'PAYLOAD';
                    } else {
                        emitEvent(currentHeader, eventData);
                        state = 'HEADER';
                    }
                }

                if (state === 'PAYLOAD') {
                    const payloadLength = currentHeader.payload_length || 0;
                    if (buffer.length < payloadLength) break; // Wait for raw binary payload

                    buffer = buffer.subarray(payloadLength);
                    emitEvent(currentHeader, eventData);
                    state = 'HEADER';
                }
            }
        }

        function emitEvent(header, data) {
            if (header.type === 'transcript') {
                const text = data?.text || '';
                client.end();
                res(text);
            }
        }

        client.on('error', (err) => rej(err));
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
