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

    const raw = readBearerToken(req.headers);
    const principal = await authenticateToken(raw ?? '');
    if (!principal) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    req.user = principal;
    next();
}
