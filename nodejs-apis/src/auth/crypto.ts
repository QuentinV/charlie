import crypto from 'crypto';

/**
 * Password and token primitives for the Charlie brain.
 *
 * Passwords use Node's built-in scrypt (no native dependency). The stored
 * format is versioned (`scrypt$N$r$p$salt$hash`) so the work factor can be
 * raised later without invalidating existing accounts.
 *
 * Tokens are opaque random strings: the plaintext is returned once to the
 * caller and only its SHA-256 hash is persisted, so a database dump does not
 * leak usable credentials.
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;
const MAX_MEM = 64 * 1024 * 1024;

export const TOKEN_PREFIX = 'chk_';
const TOKEN_BYTES = 32;
/** Characters shown in the token list so a user can tell their tokens apart. */
const TOKEN_DISPLAY_LENGTH = 12;

function scrypt(
    password: string,
    salt: Buffer,
    keylen: number,
    options: crypto.ScryptOptions
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, keylen, options, (err, key) =>
            err ? reject(err) : resolve(key)
        );
    });
}

export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.randomBytes(SALT_BYTES);
    const key = await scrypt(password, salt, SCRYPT_KEYLEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: MAX_MEM,
    });
    return [
        'scrypt',
        SCRYPT_N,
        SCRYPT_R,
        SCRYPT_P,
        salt.toString('base64url'),
        key.toString('base64url'),
    ].join('$');
}

export async function verifyPassword(
    password: string,
    stored: string | undefined | null
): Promise<boolean> {
    if (!password || !stored) return false;

    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const [, n, r, p, saltB64, hashB64] = parts;
    const expected = Buffer.from(hashB64, 'base64url');
    if (!expected.length) return false;

    try {
        const actual = await scrypt(
            password,
            Buffer.from(saltB64, 'base64url'),
            expected.length,
            {
                N: Number(n),
                r: Number(r),
                p: Number(p),
                maxmem: MAX_MEM,
            }
        );
        return (
            actual.length === expected.length &&
            crypto.timingSafeEqual(actual, expected)
        );
    } catch {
        return false;
    }
}

/**
 * A fixed hash used to spend the same scrypt time when the username does not
 * exist, so login timing cannot be used to enumerate accounts.
 */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
    dummyHash ??= hashPassword('charlie-unknown-account-placeholder');
    return dummyHash;
}

export function createRawToken(): string {
    return `${TOKEN_PREFIX}${crypto
        .randomBytes(TOKEN_BYTES)
        .toString('base64url')}`;
}

export function hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
}

export function tokenDisplayPrefix(raw: string): string {
    return raw.slice(0, TOKEN_DISPLAY_LENGTH);
}
