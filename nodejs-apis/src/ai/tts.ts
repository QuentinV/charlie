import 'dotenv/config';

const host = process.env.AI_AGENTS_HOST;

export interface TTSRequest {
    text: string;
    type?: 'audio/wav' | 'audio/L16';
}

export async function tts({
    text,
    type = 'audio/L16',
}: TTSRequest): Promise<ArrayBuffer> {
    const res = await fetch(`${host}/tts`, {
        method: 'POST',
        body: JSON.stringify({ text }),
        headers: {
            Accept: type,
        },
    });
    return res.arrayBuffer();
}
