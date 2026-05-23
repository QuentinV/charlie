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

    return res.json();
};
