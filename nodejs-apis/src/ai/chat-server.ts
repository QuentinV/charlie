import { WebSocketServer } from 'ws';
import { answer } from './flow';
import { endSession } from './llm';
import { stt } from '../echo/stt';
import { getPending, identify } from './voiceProfile';
import {
    Conversation,
    REGISTRATION_TIMEOUT_MS,
    WEB_WAKE_WORDS,
    wordWakeWords,
} from './conversation';

const WAKE_UP_REPLY = 'Oui ? Dis-moi ce que je peux faire pour toi.';

/**
 * Chat WebSocket endpoint (`/ws/chat`).
 *
 * The browser streams raw PCM16 (16 kHz, mono) audio instead of doing speech
 * recognition itself, so the server can run the local ASR **and** identify the
 * speaker through the voice profiler — the same pipeline as the echo devices.
 *
 * Frames (c / v protocol):
 *   client → { c: 'start', manual }   begin an utterance (manual = push-to-talk)
 *   client → <binary PCM16>           audio chunks of the utterance
 *   client → 'end'                    end the utterance → transcribe + answer
 *   client → 'abort'                  drop the buffered utterance
 *   client → 'played'                 reply finished playing → reopen the window
 *   client → <text> / { text }        typed message
 *   server → { c: 'transcript', v, ignored }  what ASR heard (voice turns)
 *   server → { c: 'user', v, score }  identified speaker (voice turns only)
 *   server → { c: 'text',     v }     full answer text
 *   server → { c: 'feedback', v }     short acknowledgement
 *   server → <binary WAV>             spoken answer
 *   server → { c: 'playAudio', conversation }
 */
export function setupChatServer(server: any) {
    const wss = new WebSocketServer({ server, path: '/ws/chat' });

    wss.on('connection', (ws) => {
        const conversation = new Conversation({
            strip: wordWakeWords(WEB_WAKE_WORDS),
            bareWake: 'wake',
            endSession,
            // A chat page is one conversation from first turn to disconnect:
            // the follow-up window only drives the microphone.
            sessionScope: 'connection',
        });

        let audioBuffer: Buffer[] = [];
        let manual = false;
        let processing = false;

        const send = (payload: any) => ws.send(JSON.stringify(payload));

        ws.on('error', (err: any) => {
            console.log('chat ws error', err.message);
            conversation.close();
        });

        ws.on('close', () => {
            conversation.close();
        });

        async function runTurn(
            text: string,
            options: {
                manual?: boolean;
                user?: string;
                audio?: Buffer;
                transcript?: boolean;
            } = {}
        ) {
            const decision = conversation.resolve(text, {
                manual: options.manual,
            });

            // Bare wake word ("charlie"): acknowledge and open the window.
            if (decision.wakeOnly && decision.sessionId) {
                conversation.keep(decision.sessionId);
                send({ c: 'text', v: WAKE_UP_REPLY });
                send({ c: 'playAudio', conversation: true });
                return;
            }

            if (!decision.command || !decision.sessionId) {
                // Ignored: no wake word and the follow-up window is closed.
                // Still report what was heard so the user gets feedback
                // instead of silence (voice turns only — typed input is
                // displayed by the client already).
                console.log(`[chat] ignored: "${text}"`);
                if (options.transcript) {
                    send({ c: 'transcript', v: text, ignored: true });
                }
                return;
            }

            // Show what the ASR heard (voice turns only — typed input is
            // already displayed by the client).
            if (options.transcript) {
                send({ c: 'transcript', v: text, ignored: false });
            }

            try {
                const a = await answer(decision.command, {
                    sessionId: decision.sessionId,
                    user: options.user,
                    audio: options.audio,
                    audioType: 'audio/wav',
                });
                if (a.conversation) {
                    // A voice-profile registration needs a longer window: the
                    // sentence to repeat is long to speak back.
                    conversation.keep(
                        decision.sessionId,
                        getPending(decision.sessionId)
                            ? REGISTRATION_TIMEOUT_MS
                            : undefined
                    );
                } else {
                    conversation.release(decision.sessionId);
                }

                send({ c: 'text', v: a.text });
                send({ c: 'feedback', v: a.short });
                ws.send(a.audio, { binary: true });
                send({ c: 'playAudio', conversation: a.conversation });
            } catch (e) {
                console.log('chat ws error', e);
                conversation.release(decision.sessionId);
                send({
                    c: 'text',
                    v: "Une erreur est survenue, réessaie s'il te plaît.",
                });
                send({ c: 'feedback', v: 'Erreur' });
                send({ c: 'playAudio', conversation: false });
            }
        }

        async function handleUtterance() {
            const chunks = audioBuffer;
            audioBuffer = [];
            if (!chunks.length) return;
            if (processing) {
                // The previous turn is still being answered (LLM/TTS): drop
                // this one rather than merging two utterances together.
                console.log('[chat] utterance dropped (previous turn busy)');
                return;
            }

            processing = true;
            try {
                const pcm = Buffer.concat(chunks);
                // ASR and speaker identification both consume the same
                // utterance, so run them in parallel. Identification is
                // best-effort: a down voiceprofiler must never break the chat.
                const [text, speaker] = await Promise.all([
                    stt(chunks, { record: false }),
                    identify(pcm).catch(() => undefined),
                ]);

                const user =
                    speaker?.speaker && speaker.speaker !== 'unknown'
                        ? speaker.speaker
                        : undefined;

                if (user) {
                    send({ c: 'user', v: user, score: speaker?.score ?? 0 });
                }
                if (!text || typeof text !== 'string') return;

                await runTurn(text, {
                    manual,
                    audio: pcm,
                    user,
                    transcript: true,
                });
            } catch (e) {
                console.log('chat ws error', e);
            } finally {
                processing = false;
            }
        }

        ws.on('message', async (msg, isBinary) => {
            if (isBinary) {
                audioBuffer.push(
                    Buffer.isBuffer(msg) ? msg : Buffer.from(msg as ArrayBuffer)
                );
                return;
            }

            const raw = msg.toString();
            let frame: any = null;
            try {
                frame = JSON.parse(raw);
            } catch {
                // not JSON — plain text frame
            }

            const control = typeof frame?.c === 'string' ? frame.c : raw.trim();

            if (control === 'start') {
                audioBuffer = [];
                manual = !!frame?.manual;
                return;
            }
            if (control === 'abort') {
                audioBuffer = [];
                return;
            }
            if (control === 'end') {
                await handleUtterance();
                return;
            }
            if (control === 'played') {
                // The client finished playing the reply: (re)start the
                // follow-up window from now, so the user is not racing the
                // playback of the answer.
                const sessionId = conversation.session;
                if (sessionId) {
                    conversation.keep(
                        sessionId,
                        getPending(sessionId)
                            ? REGISTRATION_TIMEOUT_MS
                            : undefined
                    );
                }
                return;
            }

            // Typed message: explicit, so the whole text is the command.
            const text = typeof frame?.text === 'string' ? frame.text : raw;
            const trimmed = (text ?? '').trim();
            if (!trimmed) return;
            await runTurn(trimmed, { manual: true });
        });
    });
}
