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

function sendPCMInChunks(ws, buffer, conversation = false, chunkSize = 8192) {
    for (let i = 0; i < buffer.length; i += chunkSize) {
        const chunk = buffer.slice(i, i + chunkSize);
        ws.send(chunk, { binary: true });
    }
    ws.send(JSON.stringify({ c: 'playAudio', conversation }));
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
                    // Speech-to-text and speaker identification both consume
                    // the same utterance, so run them in parallel. Speaker
                    // identification is best-effort: a down voiceprofiler must
                    // never break the conversation.
                    const [text, speaker] = await Promise.all([
                        stt(audioBuffer, { record: true }),
                        identify(pcm).catch(() => undefined),
                    ]);

                    const user =
                        speaker?.speaker && speaker.speaker !== 'unknown'
                            ? speaker.speaker
                            : undefined;
                    log(
                        `recognized user = ${user ?? 'unknown'} (score=${(speaker?.score ?? 0).toFixed(2)})`
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

                        if (decision.command && decision.sessionId) {
                            const a = await answer(decision.command, {
                                sessionId: decision.sessionId,
                                user,
                                audio: pcm,
                            });
                            log(
                                `result = ${a.result} (conversation = ${a.conversation})`
                            );

                            if (a.conversation) {
                                // A voice-profile registration needs a longer
                                // window: the sentence to repeat is long to
                                // speak back.
                                conversation.keep(
                                    decision.sessionId,
                                    getPending(decision.sessionId)
                                        ? REGISTRATION_TIMEOUT_MS
                                        : undefined
                                );
                            } else {
                                conversation.release(decision.sessionId);
                            }

                            ws.send(
                                JSON.stringify({ c: 'feedback', v: a.short })
                            );
                            sendPCMInChunks(ws, a.audio, a.conversation);
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
