import { WebSocketServer } from 'ws';
import { stt } from './stt';
import { tts } from '../ai/tts';
import { ask } from '../ai/flow';
import { logEcho } from './logs';
import { v4 as uuid } from 'uuid';
import {
    clearScreenUpdatesForIp,
    startScreenUpdatesForIp,
} from './screensUpdates';

const VERIFY_TEXT = ['charlie, ', 'charlie ', 'charlie. '];

// How long a wake-word utterance keeps the conversation open for follow-ups.
const CONVERSATION_TIMEOUT_MS = 10000;

function random(arr: string[]) {
    return arr[Math.floor(Math.random() * arr.length)];
}

const positiveAnswers = [
    "C'est fait.",
    "C'est fait ! Je vais m'octroyer une pause de deux secondes pour fêter ça.",
    "C'est fait ! J'espère que vous appréciez l'effort.",
    "C'est comme si c'était fait.",
    'Mission accomplie.',
    "Pas de problème, je m'en occupe.",
    "C'est réglé, chef.",
    "Biiip... boop... c'est fini!",
    'Affirmatif.',
    'Pas de souci.',
];
const notPossibleAnswers = [
    "Cette action n'est pas disponible.",
    'Je ne peux pas faire ça, malheureusement.',
    "Désolée, mes pouvoirs s'arrêtent ici.",
    'Action impossible. Mon système dit non.',
    'Erreur 404 : Volonté non trouvée.',
];
const doesNotUnderstandAnswers = [
    'Je ne comprends pas.',
    'Hein ? Peux-tu répéter ?',
    "Je n'ai pas capté un seul mot.",
    "C'est du chinois pour moi, ça.",
    'Vous parlez à une maison, là. Soyez plus clair !',
    'Pardon ? Ma logique me fait défaut.',
];

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
                    const text = await stt(audioBuffer, {
                        record: true,
                    });

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

                            const result = await ask(command, { sessionId });
                            log(`result = ${result}`);

                            const shortText =
                                result === null
                                    ? 'Comprends pas'
                                    : result === false
                                      ? `Pas possible`
                                      : 'Ok';

                            ws.send(
                                JSON.stringify({ c: 'feedback', v: shortText })
                            );

                            const longText =
                                typeof result === 'string'
                                    ? result
                                    : result === null
                                      ? random(doesNotUnderstandAnswers)
                                      : result === false
                                        ? random(notPossibleAnswers)
                                        : random(positiveAnswers);

                            const resultAudio = await tts({
                                text: longText,
                            });
                            sendPCMInChunks(ws, Buffer.from(resultAudio));
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
