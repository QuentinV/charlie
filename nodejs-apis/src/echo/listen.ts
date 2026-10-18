import { WebSocketServer } from 'ws';
import { stt } from './stt';
import { answer } from '../ai/flow';
import { endSession } from '../ai/llm';
import { getPending, identify } from '../ai/voiceProfile';
import {
    Conversation,
    ECHO_WAKE_WORDS,
    REGISTRATION_TIMEOUT_MS,
    prefixWakeWords,
} from '../ai/conversation';
import { logEcho } from './logs';
import {
    clearScreenUpdatesForIp,
    startScreenUpdatesForIp,
} from './screensUpdates';

export const connectedEchos: { [key: string]: any } = {};

/**
 * How much of the current conversation is kept for speaker identification.
 * A short command ("dis-moi qui suis-je", ~1.5 s) yields a noisy embedding;
 * concatenating the last 8 s of the session gives the extractor enough
 * material for a stable score.
 */
const IDENTIFY_MAX_BYTES = 16000 * 2 * 8;

function sendPCMInChunks(
    ws,
    buffer,
    conversation = false,
    chunkSize = 8192,
    followUpTimeoutMs?: number
) {
    for (let i = 0; i < buffer.length; i += chunkSize) {
        const chunk = buffer.slice(i, i + chunkSize);
        ws.send(chunk, { binary: true });
    }
    ws.send(
        JSON.stringify({
            c: 'playAudio',
            conversation,
            // Registration prompts ask for a long sentence to repeat: the
            // device must keep the follow-up window open long enough.
            ...(followUpTimeoutMs ? { timeout: followUpTimeoutMs } : {}),
        })
    );
}

export function setupEchoListen() {
    const wss = new WebSocketServer({ port: 9303, path: '/ws/echo' });

    wss.on('connection', (ws, req) => {
        const ip: string = req.socket.remoteAddress!;
        const log = (message: string) => logEcho(ip, message);
        connectedEchos[ip] = ws;
        log('Device connected');
        startScreenUpdatesForIp(ip);

        //ws.on('ping', () => {
        //    log('ping');
        //});;

        const conversation = new Conversation({
            strip: prefixWakeWords(ECHO_WAKE_WORDS),
            endSession,
        });
        let audioBuffer = [];
        // Last few seconds of the conversation, used to identify the speaker
        // on a longer, more stable window than a single short command.
        let sessionAudio = Buffer.alloc(0);
        ws.on('error', (err) => {
            log('WebSocket error:' + err.message);
            conversation.close();
            delete connectedEchos[ip];
            clearScreenUpdatesForIp(ip);
        });

        ws.on('close', () => {
            log('connection closed');
            conversation.close();
            delete connectedEchos[ip];
            clearScreenUpdatesForIp(ip);
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
                    const pcm = Buffer.concat(audioBuffer);
                    const contextPcm = Buffer.concat([
                        sessionAudio,
                        pcm,
                    ]).subarray(-IDENTIFY_MAX_BYTES);
                    // Speech-to-text and speaker identification both consume
                    // the same utterance, so run them in parallel. Speaker
                    // identification is best-effort: a down voiceprofiler must
                    // never break the conversation.
                    const [text, speaker] = await Promise.all([
                        stt(audioBuffer, { record: true }),
                        identify(contextPcm).catch(() => undefined),
                    ]);

                    const user =
                        speaker?.speaker && speaker.speaker !== 'unknown'
                            ? speaker.speaker
                            : undefined;
                    log(
                        `recognized user = ${user ?? 'unknown'} (score=${(
                            speaker?.score ?? 0
                        ).toFixed(2)}, threshold=${(
                            speaker?.threshold ?? 0
                        ).toFixed(2)}, samples=${speaker?.samples ?? 0})`
                    );

                    console.log('received text', text);
                    if (text && typeof text === 'string') {
                        log(`text = ${text}`);

                        // A "charlie …" utterance starts (or restarts) the
                        // conversation window; any other utterance is accepted
                        // as a follow-up while that window is still open.
                        const decision = conversation.resolve(text);
                        log(
                            `command = ${decision.command} (in conversation = ${decision.inConversation})`
                        );

                        // Keep this turn's audio for the next identification
                        // window; a turn outside the conversation (a fresh
                        // wake word) starts a new one.
                        sessionAudio = decision.inConversation
                            ? Buffer.concat([sessionAudio, pcm]).subarray(
                                  -IDENTIFY_MAX_BYTES
                              )
                            : pcm.subarray(-IDENTIFY_MAX_BYTES);

                        if (decision.command && decision.sessionId) {
                            const a = await answer(decision.command, {
                                sessionId: decision.sessionId,
                                user,
                                audio: pcm,
                            });
                            log(
                                `result = ${a.result} (conversation = ${a.conversation})`
                            );

                            const registering = !!getPending(
                                decision.sessionId
                            );
                            if (a.conversation) {
                                // A voice-profile registration needs a longer
                                // window: the sentence to repeat is long to
                                // speak back.
                                conversation.keep(
                                    decision.sessionId,
                                    registering
                                        ? REGISTRATION_TIMEOUT_MS
                                        : undefined
                                );
                            } else {
                                conversation.release(decision.sessionId);
                            }

                            ws.send(
                                JSON.stringify({ c: 'feedback', v: a.short })
                            );
                            sendPCMInChunks(
                                ws,
                                a.audio,
                                a.conversation,
                                8192,
                                a.conversation && registering
                                    ? REGISTRATION_TIMEOUT_MS
                                    : undefined
                            );
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
