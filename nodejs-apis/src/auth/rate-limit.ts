/**
 * In-memory login throttling.
 *
 * A single process owns the API, so a Map is enough — no dependency and no
 * extra collection. Keys are `ip|<address>` and `user|<name>|<address>`; both
 * must pass, which slows down both password guessing and username sweeps.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const MAX_ENTRIES = 500;

interface Entry {
    failures: number;
    resetAt: number;
    /** Per-key threshold (a shared IP gets a higher budget than one account). */
    limit: number;
}

const entries = new Map<string, Entry>();

function prune(now: number) {
    for (const [key, entry] of entries) {
        if (entry.resetAt <= now) entries.delete(key);
    }
}

export function checkLoginRate(key: string): {
    blocked: boolean;
    retryAfterSeconds: number;
} {
    const now = Date.now();
    const entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
        return { blocked: false, retryAfterSeconds: 0 };
    }
    if (entry.failures < entry.limit) {
        return { blocked: false, retryAfterSeconds: 0 };
    }
    return {
        blocked: true,
        retryAfterSeconds: Math.max(
            1,
            Math.ceil((entry.resetAt - now) / 1000)
        ),
    };
}

export function recordLoginFailure(key: string, limit = MAX_FAILURES) {
    const now = Date.now();
    if (entries.size > MAX_ENTRIES) prune(now);

    const entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
        entries.set(key, { failures: 1, resetAt: now + WINDOW_MS, limit });
        return;
    }
    entry.failures += 1;
}

export function clearLoginFailures(key: string) {
    entries.delete(key);
}
