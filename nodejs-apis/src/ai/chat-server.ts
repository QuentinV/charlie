import { WebSocketServer } from 'ws';
import { answer } from './flow';

/**
 * Chat WebSocket endpoint.
 *
 * The client does STT in the browser and sends the recognized TEXT here.
 * This server calls `answer` (NLU → LLM fallback → TTS) and replies with the
 * answer as text plus spoken audio (WAV) synthesised via the TTS container.
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
                const a = await answer(text, { audioType: 'audio/wav' });

                ws.send(JSON.stringify({ c: 'text', v: a.text }));
                ws.send(JSON.stringify({ c: 'feedback', v: a.short }));
                ws.send(a.audio, { binary: true });
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
