import { WebSocketServer } from 'ws';
import { stt } from './stt';
import { answer } from '../ai/flow';
import { identify } from '../ai/voiceProfile';
import { logEcho } from './logs';
import { v4 as uuid } from 'uuid';
import {
    clearScreenUpdatesForIp,
    startScreenUpdatesForIp,
} from './screensUpdates';

const VERIFY_TEXT = ['charlie, ', 'charlie ', 'charlie. '];

// How long a wake-word utterance keeps the conversation open for follow-ups.
const CONVERSATION_TIMEOUT_MS = 10000;

export const connectedEchos: { [key: string]: any } = {};

function sendPCMInChunks(ws, buffer, chunkSize = 8192) {
    for (let i = 0; i < buffer.length; i += chunkSize) {
        const chunk = buffer.slice(i, i + chunkSize);
        ws.send(chunk, { binary: true });
    }
    ws.send(JSON.stringify({ c: 'playAudio' }));
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
        const ip: string = req.socket.remoteAddress!;
        const log = (message: string) => logEcho(ip, message);
        connectedEchos[ip] = ws;
        log('Device connected');
        startScreenUpdatesForIp(ip);

        //ws.on('ping', () => {
        //    log('ping');
        //});;

        let audioBuffer = [];
        let conversationUntil = 0;
        const sessionId = uuid();
        ws.on('error', (err) => {
            log('WebSocket error:' + err.message);
            delete connectedEchos[ip];
            clearScreenUpdatesForIp(ip);
        });

        ws.on('close', () => {
            log('connection closed');
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
                        const valid = verify(text);
                        log(`text verified = ${valid}`);

                        // A "charlie …" utterance starts (or restarts) the
                        // conversation window; any other utterance is accepted
                        // as a follow-up while that window is still open.
                        const inConversation = Date.now() < conversationUntil;
                        const command =
                            typeof valid === 'string' && valid.trim()
                                ? valid.trim()
                                : inConversation && text.trim()
                                  ? text.trim()
                                  : undefined;
                        log(
                            `command = ${command} (in conversation = ${inConversation})`
                        );

                        if (command) {
                            conversationUntil =
                                Date.now() + CONVERSATION_TIMEOUT_MS;

                            const a = await answer(command, {
                                sessionId,
                                user,
                                audio: pcm,
                            });
                            log(`result = ${a.result}`);

                            ws.send(
                                JSON.stringify({ c: 'feedback', v: a.short })
                            );
                            sendPCMInChunks(ws, a.audio);
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
