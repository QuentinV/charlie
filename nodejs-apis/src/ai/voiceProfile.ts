import 'dotenv/config';
import net from 'net';
import { pcmToWav } from '../echo/utils';
import { normalize } from './nlu/utils';

// Wyoming TCP endpoint (streaming audio) used to identify a speaker.
const wyomingFullHost = process.env.VOICE_PROFILER_HOST ?? 'voiceprofiler:10400';
const wyomingHost = wyomingFullHost.substring(0, wyomingFullHost.indexOf(':'));
const wyomingPort = Number(
    wyomingFullHost.substring(wyomingFullHost.indexOf(':') + 1)
);

// FastAPI HTTP endpoint used to register / list voice profiles.
const httpHost = process.env.VOICE_PROFILER_HTTP_HOST ?? 'voiceprofiler:8000';

const IDENTIFY_TIMEOUT_MS = 5000;

// Registration is a 2-turn conversation: first the name, then a repeated
// sentence used as the voice sample. A pending registration expires if the
// user stops responding.
const PENDING_TTL_MS = 30000;

export type PendingPhase = 'name' | 'sample';

export interface PendingRegistration {
    phase: PendingPhase;
    /** Resolved name, only known from the `sample` phase onwards. */
    name?: string;
    until: number;
}

const pending = new Map<string, PendingRegistration>();

export interface SpeakerIdentification {
    speaker: string;
    score: number;
}

/**
 * Identify the speaker of a raw PCM16 (16kHz, mono) utterance through the
 * voiceprofiler Wyoming endpoint. Mirrors the framing used by `stt.ts`.
 * Resolves to `undefined` when the service is unreachable or silent.
 */
export async function identify(
    pcm: Buffer
): Promise<SpeakerIdentification | undefined> {
    return new Promise((resolve) => {
        const client = new net.Socket();
        let settled = false;

        const done = (result?: SpeakerIdentification) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            try {
                client.end();
            } catch {
                // socket already closed
            }
            resolve(result);
        };

        const timeout = setTimeout(() => done(), IDENTIFY_TIMEOUT_MS);

        client.connect(wyomingPort, wyomingHost, () => {
            client.write(
                JSON.stringify({
                    type: 'audio-start',
                    data: { rate: 16000, width: 2, channels: 1 },
                }) + '\n'
            );

            // Send PCM audio in 30ms chunks (960 bytes at 16kHz 16-bit)
            const chunkSize = 960;
            for (let offset = 0; offset < pcm.length; offset += chunkSize) {
                const chunk = pcm.subarray(offset, offset + chunkSize);
                client.write(
                    JSON.stringify({
                        type: 'audio-chunk',
                        data: { rate: 16000, width: 2, channels: 1 },
                        payload_length: chunk.length,
                    }) + '\n'
                );
                client.write(chunk);
            }

            client.write(
                JSON.stringify({ type: 'audio-stop', data: {} }) + '\n'
            );
        });

        // --- Wyoming Protocol Stream Parser State Machine ---
        let buffer = Buffer.alloc(0);
        let state = 'HEADER';
        let currentHeader: any = null;
        let eventData: any = null;

        client.on('data', (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            processBuffer();
        });

        function processBuffer() {
            while (true) {
                if (state === 'HEADER') {
                    const newlineIndex = buffer.indexOf('\n');
                    if (newlineIndex === -1) break;

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
                    if (buffer.length < dataLength) break;

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
                    if (buffer.length < payloadLength) break;

                    buffer = buffer.subarray(payloadLength);
                    emitEvent(currentHeader, eventData);
                    state = 'HEADER';
                }
            }
        }

        function emitEvent(header: any, data: any) {
            if (header.type === 'speaker-identified') {
                done({
                    speaker: data?.speaker ?? 'unknown',
                    score: data?.score ?? 0,
                });
            }
        }

        client.on('error', () => done());
        client.on('close', () => done());
    });
}


/**
 * Register (or update) a voice profile from a raw PCM16 (16kHz, mono)
 * utterance. Wraps the PCM in a WAV container and posts it to the FastAPI
 * `register` endpoint. Returns `false` when the service is unreachable.
 */
export async function register(
    username: string,
    pcm: Buffer
): Promise<boolean> {
    try {
        const wav = pcmToWav(pcm);
        const form = new FormData();
        form.append(
            'file',
            new Blob([wav], { type: 'audio/wav' }),
            'sample.wav'
        );

        const res = await fetch(
            `http://${httpHost}/register/${encodeURIComponent(username)}`,
            { method: 'POST', body: form }
        );
        if (!res.ok) {
            return false;
        }
        const data: any = await res.json().catch(() => undefined);
        const ok = data?.status === 'success';
        console.log(
            `[voiceProfile] register ${username} => ${ok ? 'success' : 'failed'}`
        );
        return ok;
    } catch (e) {
        console.error(
            `[voiceProfile] register failed: ${(e as any)?.message ?? e}`
        );
        return false;
    }
}

/** List the usernames that have a voice profile registered. */
export async function listUsers(): Promise<string[]> {
    try {
        const res = await fetch(`http://${httpHost}/users`);
        if (!res.ok) return [];
        const data: any = await res.json();
        return data?.registered_users ?? [];
    } catch {
        return [];
    }
}

/** Arm the 2-turn registration flow for a session. */
export function beginRegistration(sessionId: string): void {
    if (!sessionId) return;
    pending.set(sessionId, {
        phase: 'name',
        until: Date.now() + PENDING_TTL_MS,
    });
}

/** Return the active pending registration for a session, if any. */
export function getPending(
    sessionId?: string
): PendingRegistration | undefined {
    if (!sessionId) return;
    const p = pending.get(sessionId);
    if (!p) return;
    if (Date.now() > p.until) {
        pending.delete(sessionId);
        return;
    }
    return p;
}

/** Move a pending registration from the `name` to the `sample` phase. */
export function advanceToSample(sessionId: string, name: string): void {
    pending.set(sessionId, {
        phase: 'sample',
        name,
        until: Date.now() + PENDING_TTL_MS,
    });
}

/** Cancel any pending registration for a session. */
export function clearPending(sessionId?: string): void {
    if (sessionId) pending.delete(sessionId);
}

// Common French ways of giving one's name, normalized (accents/punctuation
// removed, hyphens/apostrophes turned into spaces) like `normalize()` does.
const NAME_LEAD_INS = [
    'je m appelle',
    'je me nomme',
    'mon nom est',
    'mon prenom est',
    'moi c est',
    'c est',
    'je suis',
    'appelle moi',
];

/** Split into words the same way `normalize()` does, keeping accents/casing. */
function canonicalWords(raw: string): string[] {
    return raw
        .replace(/[.,;:!?]/g, '')
        .replace(/[-–—'’]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ');
}

/**
 * Extract a person's name from a spoken answer, stripping common lead-ins
 * ("je m'appelle", "mon nom est", "moi c'est", "c'est", "je suis"…). Returns
 * `undefined` when no name can be found.
 */
export function extractName(raw: string): string | undefined {
    const words = canonicalWords(raw ?? '');
    const normalized = normalize(raw ?? '');

    let start = 0;
    for (const lead of NAME_LEAD_INS) {
        if (normalized === lead) return;
        if (normalized.startsWith(`${lead} `)) {
            start = lead.split(' ').length;
            break;
        }
    }

    const nameWords = words.slice(start).filter(Boolean);
    if (!nameWords.length) return;
    return nameWords
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

