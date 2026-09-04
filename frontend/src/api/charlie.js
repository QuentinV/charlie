export const HOST = '/api';

export const api = async (url, init = undefined) => {
    const res = await fetch(`${HOST}/${url}`, {
        ...(init ?? {}),
        headers: [
            //['x-language', i18n.language ?? 'en'],
            ['Content-Type', 'application/json'],
        ],
    });

    if (res.status === 404) return null;

    if (res.status === 204) {
        return;
    }

    // Parse JSON when possible, fall back to text so callers never hit
    // "Unexpected token ... is not valid JSON" for plain-text error bodies.
    const text = await res.text();
    if (!text) return;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};
