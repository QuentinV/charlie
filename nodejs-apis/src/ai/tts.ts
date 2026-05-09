import 'dotenv/config';

const host = process.env.TTS_HOST ?? 'tts:9301';

export interface TTSRequest {
    text: string;
    type?: 'audio/wav' | 'audio/L16';
}

export async function tts({
    text,
    type = 'audio/L16',
}: TTSRequest): Promise<ArrayBuffer> {
    const res = await fetch(`http://${host}/tts`, {
        method: 'POST',
        body: JSON.stringify({ text }),
        headers: {
            Accept: type,
        },
    });
    return res.arrayBuffer();
}
