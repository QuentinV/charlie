export const HOST = '/api';

/** localStorage key holding the long-lived bearer token. */
export const TOKEN_STORAGE_KEY = 'charlie.auth.token';

/** Fired when the server rejects the stored token (revoked or expired). */
export const UNAUTHORIZED_EVENT = 'charlie:unauthorized';

export const getToken = () => {
    try {
        return window.localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
        return null;
    }
};

export const setToken = (token) => {
    try {
        if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
        else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
        // Storage disabled (private mode): the session lasts until reload.
    }
};

export const clearToken = () => setToken(null);

export class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

const buildHeaders = (init) => {
    const headers = new Headers(init?.headers ?? {});
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return headers;
};

const readBody = async (res) => {
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

const request = async (url, init) => {
    const hadToken = !!getToken();
    const res = await fetch(`${HOST}/${url}`, {
        ...(init ?? {}),
        headers: buildHeaders(init),
    });
    const data = await readBody(res);

    // A rejected session token is dropped so the UI falls back to the login
    // screen. Auth endpoints are exempt: a wrong password is also a 401 and
    // must not sign the user out of a valid session.
    if (res.status === 401 && hadToken && !url.startsWith('auth/')) {
        clearToken();
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
        }
    }

    return { res, data };
};

export const api = async (url, init = undefined) => {
    const { res, data } = await request(url, init);

    if (res.status === 404) return null;
    if (res.status === 204) return;

    return data;
};

/**
 * Same as `api()` but throws an `ApiError` on non-2xx responses, for forms
 * (login, token creation…) that need to display the server message.
 */
export const apiStrict = async (url, init = undefined) => {
    const { res, data } = await request(url, init);

    if (!res.ok) {
        throw new ApiError(
            res.status,
            data?.message ?? data?.error ?? res.statusText ?? 'Request failed'
        );
    }
    if (res.status === 204) return;

    return data;
};

