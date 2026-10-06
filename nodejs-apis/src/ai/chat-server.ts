import { WebSocketServer } from 'ws';
import { ask } from './flow';
import { tts } from './tts';

function random(arr: string[]) {
    return arr[Math.floor(Math.random() * arr.length)];
}

const positiveAnswers = [
    "C'est fait.",
    'Mission accomplie.',
    "Pas de problème, je m'en occupe.",
    "C'est réglé.",
    'Affirmatif.',
    'Pas de souci.',
];

const notPossibleAnswers = [
    "Cette action n'est pas disponible.",
    'Je ne peux pas faire ça, malheureusement.',
    'Action impossible.',
];

const doesNotUnderstandAnswers = [
    'Je ne comprends pas.',
    'Hein ? Peux-tu répéter ?',
    "Je n'ai pas capté un seul mot.",
];

function longTextFor(result: unknown): string {
    if (typeof result === 'string') return result;
    if (result === null) return random(doesNotUnderstandAnswers);
    if (result === false) return random(notPossibleAnswers);
    return random(positiveAnswers);
}

function shortTextFor(result: unknown): string {
    if (typeof result === 'string') return 'Ok';
    if (result === null) return 'Je ne comprends pas.';
    if (result === false) return 'Pas possible.';
    return 'Ok';
}

/**
 * Chat WebSocket endpoint.
 *
 * The client does STT in the browser and sends the recognized TEXT here.
 * This server calls `ask` (NLU → LLM fallback) and replies with the answer as
 * text plus spoken audio (WAV) synthesised via the TTS container.
 *
 * Frames (c / v protocol):
 *   client → text (or JSON { text })
 *   server → { c: 'text',     v: <full answer text> }   for the chat UI
 *   server → { c: 'feedback', v: <short ack> }
 *   server → <binary WAV>
 *   server → { c: 'playAudio' }
 */
export function setupChatServer(server: any) {
    const wss = new WebSocketServer({ server, path: '/ws/chat' });

    wss.on('connection', (ws) => {
        ws.on('error', (err: any) => {
            console.log('chat ws error', err.message);
        });

        ws.on('message', async (msg) => {
            let text: string;
            if (typeof msg === 'string') {
                text = msg;
            } else {
                text = Buffer.from(msg as ArrayBuffer).toString('utf8');
            }

            // Accept either a plain string or a JSON { text } payload.
            try {
                const parsed = JSON.parse(text);
                if (typeof parsed?.text === 'string') {
                    text = parsed.text;
                }
            } catch {
                // raw text
            }

            text = text?.trim() ?? '';
            if (!text) return;

            try {
                const result = await ask(text);
                const longText = longTextFor(result);

                ws.send(JSON.stringify({ c: 'text', v: longText }));
                ws.send(
                    JSON.stringify({ c: 'feedback', v: shortTextFor(result) })
                );

                const audio = await tts({ text: longText, type: 'audio/wav' });
                ws.send(Buffer.from(audio), { binary: true });
                ws.send(JSON.stringify({ c: 'playAudio' }));
            } catch (e) {
                console.log('chat ws error', e);
                ws.send(
                    JSON.stringify({
                        c: 'text',
                        v: "Une erreur est survenue, réessaie s'il te plaît.",
                    })
                );
                ws.send(JSON.stringify({ c: 'feedback', v: 'Erreur' }));
            }
        });
    });
}
