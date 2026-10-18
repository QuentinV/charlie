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

// Registration is a multi-turn conversation: the name, then three sentences
// (the last one is held out to verify the profile), then optional rescue
// sentences. Every recorded sample refreshes the TTL; an abandoned
// registration simply expires.
const PENDING_TTL_MS = 30000;

// Consecutive unusable recordings (silence, too short, unverifiable) before
// the flow gives up instead of looping forever.
export const MAX_SAMPLE_RETRIES = 3;

/**
 * Sentences the user repeats during enrolment. They are deliberately varied
 * (nasals, fricatives, plosives, different lengths) so the profile does not
 * depend on a single phonetic context.
 *
 * The third sentence is the verification sample: it is scored against the
 * profile built from the first two, which is exactly the comparison
 * identification performs later.
 */
export const ENROLLMENT_SENTENCES = [
    "Bonjour Charlie, j'active mon profil vocal aujourd'hui.",
    'Le grand chêne sombre cache la maison sous la pluie.',
    "S'il te plaît, vérifie mon identité pour continuer.",
];

/** Additional sentences offered when the verification is not convincing. */
export const EXTRA_SENTENCES = [
    'Les vagues brillantes dansent sur le sable mouillé.',
    'Mon chat gris dort près de la fenêtre ouverte.',
    'Nous partirons demain matin avant le lever du soleil.',
];

export const BASE_SAMPLE_COUNT = ENROLLMENT_SENTENCES.length;
export const MAX_ENROLLMENT_SAMPLES = BASE_SAMPLE_COUNT + 2;

// 1.2 s of PCM16 16 kHz mono: below this an embedding is too noisy.
export const MIN_SAMPLE_BYTES = 16000 * 2 * 1.2;

// ~-54 dBFS in normalised float samples: only near-silence is rejected here.
// The profiler applies the authoritative level gate (-55 dBFS by default);
// echo captures measure around -44 dBFS, so this must stay well below it.
const MIN_SAMPLE_RMS = 0.002;

export type PendingPhase = 'name' | 'sample';

export interface PendingRegistration {
    phase: PendingPhase;
    /** Resolved name, only known from the `sample` phase onwards. */
    name?: string;
    /** Audio samples recorded so far, in sentence order. */
    samples: Buffer[];
    /** Consecutive rejected attempts (silence, too short, unverifiable). */
    rejections: number;
    until: number;
}

const pending = new Map<string, PendingRegistration>();

export interface SpeakerIdentification {
    speaker: string;
    score: number;
    /** Display-only mapping of `score` to 0..1 (set by the profiler). */
    confidence?: number;
    /** Cosine a speaker must reach to be named (set by the profiler). */
    threshold?: number;
    /** Number of enrolment samples behind the matching profile. */
    samples?: number;
}

export interface EnrollmentScores {
    /** Held-out sample vs the profile of the previous ones. */
    test: number;
    /** Worst leave-one-out consistency of the enrolment samples. */
    looMin: number;
    /** Mean leave-one-out consistency of the enrolment samples. */
    looMean: number;
    /** Mean sample-to-centroid similarity. */
    centroidMean: number;
}

export interface EnrollmentReport {
    status: 'success' | 'low_confidence' | 'rejected';
    accepted: boolean;
    committed: boolean;
    samples: number;
    keptSamples?: number;
    confidence?: number;
    threshold?: number;
    scores?: EnrollmentScores;
    /** Index (0-based) of the rejected sample, when `status` is `rejected`. */
    sampleIndex?: number;
    reason?: string;
}

/** What the flow should do after an enrolment attempt. */
export type EnrollmentStep = 'done' | 'more' | 'retry' | 'abort';

/** Sentence to speak for the sample at `index` (base list, then extras). */
export function sentenceFor(index: number): string {
    if (index <= 0) return ENROLLMENT_SENTENCES[0];
    if (index < BASE_SAMPLE_COUNT) return ENROLLMENT_SENTENCES[index];
    const extra = index - BASE_SAMPLE_COUNT;
    return EXTRA_SENTENCES[extra % EXTRA_SENTENCES.length];
}

export interface AudioStats {
    seconds: number;
    rms: number;
    usable: boolean;
}

/**
 * Cheap client-side check before spending a round-trip on the profiler: a
 * silent or too-short recording is re-prompted rather than enrolled.
 */
export function audioStats(pcm: Buffer): AudioStats {
    const sampleCount = Math.floor((pcm?.length ?? 0) / 2);
    const seconds = sampleCount / 16000;
    if (!sampleCount) return { seconds: 0, rms: 0, usable: false };

    // Averaging on a subsample keeps this O(1) for long utterances.
    const stride = Math.max(1, Math.floor(sampleCount / 48000));
    let sum = 0;
    let count = 0;
    for (let index = 0; index < sampleCount; index += stride) {
        const value = pcm.readInt16LE(index * 2) / 32768;
        sum += value * value;
        count += 1;
    }
    const rms = Math.sqrt(sum / count);
    return {
        seconds,
        rms,
        usable: pcm.length >= MIN_SAMPLE_BYTES && rms >= MIN_SAMPLE_RMS,
    };
}

/**
 * Decide what to ask next after an enrolment attempt.
 *
 * `retry` means the profiler rejected the recording itself (silence, clipping,
 * too short): the same sentence is asked again, without adding a sample.
 */
export function nextStep(
    report: EnrollmentReport | undefined,
    attempts: number
): EnrollmentStep {
    if (!report) return 'abort';
    if (report.accepted) return 'done';
    if (report.status === 'rejected') return 'retry';
    return attempts < MAX_ENROLLMENT_SAMPLES ? 'more' : 'abort';
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
                    confidence: data?.confidence,
                    threshold: data?.threshold,
                    samples: data?.samples,
                });
            }
        }

        client.on('error', () => done());
        client.on('close', () => done());
    });
}


function num(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Map the profiler's snake_case enrolment report onto the client type. */
function toEnrollmentReport(data: any): EnrollmentReport {
    const scores = data?.scores ?? {};
    let status: EnrollmentReport['status'] = 'low_confidence';
    if (data?.status === 'rejected') status = 'rejected';
    else if (data?.accepted) status = 'success';

    return {
        status,
        accepted: !!data?.accepted,
        committed: !!data?.committed,
        samples: num(data?.samples),
        keptSamples: num(data?.kept_samples),
        confidence: num(data?.confidence),
        threshold: num(data?.threshold),
        scores: {
            test: num(scores.test),
            looMin: num(scores.loo_min),
            looMean: num(scores.loo_mean),
            centroidMean: num(scores.centroid_mean),
        },
        sampleIndex:
            typeof data?.sample_index === 'number'
                ? data.sample_index
                : undefined,
        reason: typeof data?.reason === 'string' ? data.reason : undefined,
    };
}

/**
 * Enrol (or re-enrol) a voice profile from the recorded sentences.
 *
 * The profiler keeps one embedding per sample and builds a centroid from
 * them; the last sample is held out and scored against the others, so the
 * profile is only replaced when the new recording actually verifies. Returns
 * `undefined` when the service is unreachable or the request is invalid.
 */
export async function enroll(
    username: string,
    samples: Buffer[]
): Promise<EnrollmentReport | undefined> {
    try {
        if (!username || samples.length < 2) return;

        const form = new FormData();
        samples.forEach((pcm, index) => {
            form.append(
                'files',
                new Blob([pcmToWav(pcm)], { type: 'audio/wav' }),
                `sample-${index + 1}.wav`
            );
        });

        const res = await fetch(
            `http://${httpHost}/enroll/${encodeURIComponent(username)}`,
            { method: 'POST', body: form }
        );
        const data: any = await res.json().catch(() => undefined);
        if (!res.ok) {
            console.error(
                `[voiceProfile] enroll ${username} failed: ${res.status}`
            );
            return;
        }

        const report = toEnrollmentReport(data);
        console.log(
            `[voiceProfile] enroll ${username}: ${report.status}` +
                ` (samples=${report.samples}, test=${report.scores?.test ?? 0},` +
                ` loo_min=${report.scores?.looMin ?? 0},` +
                ` committed=${report.committed})`
        );
        return report;
    } catch (e) {
        console.error(
            `[voiceProfile] enroll failed: ${(e as any)?.message ?? e}`
        );
        return;
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

function freshRegistration(
    phase: PendingPhase,
    fields: Partial<PendingRegistration> = {}
): PendingRegistration {
    return {
        phase,
        samples: [],
        rejections: 0,
        until: Date.now() + PENDING_TTL_MS,
        ...fields,
    };
}

/** Drop expired registrations (a user who walked away). */
function pruneExpired(): void {
    const now = Date.now();
    for (const [sessionId, registration] of pending) {
        if (now > registration.until) pending.delete(sessionId);
    }
}

/** Arm the multi-turn registration flow for a session. */
export function beginRegistration(sessionId: string): void {
    if (!sessionId) return;
    pruneExpired();
    pending.set(sessionId, freshRegistration('name'));
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
    if (!sessionId) return;
    pending.set(sessionId, freshRegistration('sample', { name }));
}

/**
 * Store a recorded sentence and refresh the registration TTL. Returns the
 * number of samples collected so far.
 */
export function addSample(sessionId: string, pcm: Buffer): number {
    const registration = pending.get(sessionId);
    if (!registration) return 0;
    registration.samples.push(pcm);
    registration.rejections = 0;
    registration.until = Date.now() + PENDING_TTL_MS;
    return registration.samples.length;
}

/** Drop the last recorded sample (it was rejected by the profiler). */
export function popSample(sessionId: string): void {
    pending.get(sessionId)?.samples.pop();
}

/** A copy of the samples recorded so far, in sentence order. */
export function getSamples(sessionId?: string): Buffer[] {
    if (!sessionId) return [];
    return [...(pending.get(sessionId)?.samples ?? [])];
}

/**
 * Record an unusable attempt (silence, short recording, failed verification).
 * Returns the number of consecutive rejections.
 */
export function markRejectedSample(sessionId: string): number {
    const registration = pending.get(sessionId);
    if (!registration) return 0;
    registration.rejections += 1;
    registration.until = Date.now() + PENDING_TTL_MS;
    return registration.rejections;
}

/** Cancel any pending registration for a session. */
export function clearPending(sessionId?: string): void {
    if (sessionId) pending.delete(sessionId);
}

// Ways of abandoning the registration instead of recording a sample.
const ABORT_PHRASES = [
    'annule',
    'annuler',
    'laisse tomber',
    'stop',
    'arrete',
    'oublie',
    'pas maintenant',
];

/**
 * Whether the utterance is the user cancelling the registration ("annule",
 * "laisse tomber"…). Checked before treating the audio as a voice sample, so
 * an aborted flow does not enrol a sentence spoken for another reason.
 */
export function isAbortPhrase(raw: string): boolean {
    const text = normalize(raw ?? '');
    if (!text) return false;
    return ABORT_PHRASES.some(
        (phrase) => text === phrase || text.startsWith(`${phrase} `)
    );
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

