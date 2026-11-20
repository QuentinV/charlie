import { settings } from '../manager/services/settings';
import { AuthPrincipal } from '../types';
import { findTokenByRaw, touchToken } from './store';

/**
 * Public routes when protection is enabled.
 *
 * Every entry is deliberate:
 * - login/status/setup: needed to sign in (setup only works while no account
 *   exists — the endpoint returns 409 afterwards);
 * - the ESP32 OTA download: the firmware has no way to send a token, and a
 *   firmware binary is not a secret;
 * - Swagger: a documentation page with no data; every call it makes is
 *   authenticated like any other.
 * OPTIONS is always let through so CORS preflight works.
 */
const PUBLIC_ROUTES: { method: string; path: string }[] = [
    { method: 'GET', path: '/api/auth/status' },
    { method: 'POST', path: '/api/auth/login' },
    { method: 'POST', path: '/api/auth/setup' },
];

const FIRMWARE_PATH = /^\/api\/echo\/[^/]+\/latest\/firmware\.bin$/;

export function isPublicRoute(method: string, path: string): boolean {
    const m = (method ?? 'GET').toUpperCase();
    const p = (path ?? '').replace(/\/+$/, '') || '/';

    if (m === 'OPTIONS') return true;
    if (p === '/api-docs' || p.startsWith('/api-docs/')) return true;
    if (m === 'GET' && FIRMWARE_PATH.test(p)) return true;

    return PUBLIC_ROUTES.some((r) => r.method === m && r.path === p);
}

export function readBearerToken(headers: any): string | null {
    const raw = headers?.authorization ?? headers?.Authorization;
    if (typeof raw !== 'string') return null;
    const match = raw.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : null;
}

/**
 * The only routes that also accept `?token=`. A `<img>` (or `<video>`) cannot
 * send a header, and the live camera view *is* an `<img>` pointing at a stream —
 * the same convention the browser chat socket uses. The second one is
 * `vision-feed`'s relay: cv2 opens the URL and cannot send a header either.
 * Deliberately narrow: a token in a URL ends up in access logs, so nothing else
 * accepts one.
 */
const TOKEN_IN_QUERY_ROUTES: RegExp[] = [
    /^\/api\/devices\/[^/]+\/stream$/,
    /^\/api\/vision\/feeds\/[^/]+\/stream$/,
];

export function acceptsTokenInQuery(method: string, path: string): boolean {
    if ((method ?? 'GET').toUpperCase() !== 'GET') return false;
    const p = (path ?? '').replace(/\/+$/, '') || '/';
    return TOKEN_IN_QUERY_ROUTES.some((route) => route.test(p));
}

/** `?token=…` (a string, or the first of an array); null when absent. */
export function readQueryToken(query: any): string | null {
    const raw = query?.token;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function authenticateToken(
    raw: string
): Promise<AuthPrincipal | null> {
    if (!raw) return null;
    const record = await findTokenByRaw(raw);
    if (!record) return null;
    await touchToken(record);
    return {
        user: record.user,
        tokenId: record._id,
        name: record.name,
        kind: record.kind,
    };
}

/**
 * Single gate for the whole HTTP surface. Reads the live settings cache, so
 * turning `auth.enabled` on/off applies to the next request (no restart).
 */
export async function authGate(req: any, res: any, next: any) {
    if (!settings.auth?.enabled) return next();

    const path = req.path ?? (req.url ?? '').split('?')[0];
    if (isPublicRoute(req.method, path)) return next();

    const raw =
        readBearerToken(req.headers) ??
        (acceptsTokenInQuery(req.method, path)
            ? readQueryToken(req.query)
            : null);
    const principal = await authenticateToken(raw ?? '');
    if (!principal) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    req.user = principal;
    next();
}
