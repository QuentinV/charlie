import 'dotenv/config';
import fs from 'fs';

const host = process.env.AI_AGENTS_HOST;

export interface TTSRequest {
    text: string;
    type?: 'audio/wav' | 'audio/L16';
}

export async function tts({ text, type = 'audio/L16' }: TTSRequest) {
    const res = await fetch(`${host}/tts`, {
        method: 'POST',
        body: JSON.stringify({ text }),
        headers: {
            Accept: type,
        },
    });
    return res.arrayBuffer();
}

(async () => {
    fs.writeFileSync(
        'test.wav',
        Buffer.from(await tts({ text: 'Salut!', type: 'audio/wav' }))
    );
})();
