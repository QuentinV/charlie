/**
 * Service tokens: the brain mints a long-lived API token for a co-located
 * service (vision-feed, …) and writes its **plaintext** to
 * `.private/<name>.token`, so that service reads it — no manual token, no
 * network trust. Like every other token, only the SHA-256 hash is stored; the
 * file is a secret on disk (mode 0600) and is gitignored.
 */
import fs from 'fs';
import path from 'path';
import {
    createTokenRecord,
    findTokenByRaw,
    revokeTokensByName,
} from './store';

/** Where service tokens are written (mounted into the services that read them). */
export const PRIVATE_DIR =
    process.env.PRIVATE_DIR ?? path.join(process.cwd(), '.private');

/** The raw token in a file, trimmed; undefined when the file is missing/empty. */
export function readTokenFile(file: string): string | undefined {
    try {
        const value = fs.readFileSync(file, 'utf8').trim();
        return value || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Ensure a named service token exists. Idempotent: reuses a still-valid token,
 * otherwise mints one and writes it 0600 (pruning any orphaned record first).
 * Returns the raw token — callers must never log it.
 */
export async function ensureServiceToken(
    name: string,
    dir: string = PRIVATE_DIR
): Promise<string> {
    const file = path.join(dir, `${name}.token`);

    const existing = readTokenFile(file);
    if (existing && (await findTokenByRaw(existing))) return existing;

    await revokeTokensByName(name);
    const { raw } = await createTokenRecord({
        name,
        kind: 'api',
        user: 'system',
    });

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, raw, { mode: 0o600 });
    console.log(`[auth] service token "${name}" written to ${file}`);
    return raw;
}
