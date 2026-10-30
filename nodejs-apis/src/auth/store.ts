import crypto from 'crypto';
import { cs } from '../core/db';
import {
    createRawToken,
    getDummyHash,
    hashPassword,
    hashToken,
    tokenDisplayPrefix,
    verifyPassword,
} from './crypto';

export interface Account {
    _id: string;
    username: string;
    passwordHash: string;
    role: string;
    createdAt: Date;
    passwordUpdatedAt: Date;
}

export type TokenKind = 'session' | 'api';

export interface ApiTokenRecord {
    _id: string;
    name: string;
    kind: TokenKind;
    tokenHash: string;
    prefix: string;
    user: string;
    createdAt: Date;
    lastUsedAt: Date | null;
    /** `null` = long-lived (the default: the UI never asks for a login again). */
    expiresAt: Date | null;
}

/** Token fields safe to send to the UI (never the hash). */
export interface ApiTokenInfo {
    _id: string;
    name: string;
    kind: TokenKind;
    prefix: string;
    user: string;
    createdAt: Date;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
}

export function normalizeUsername(username: string): string {
    return (username ?? '').trim().toLowerCase();
}

// ---- Accounts

export async function countAccounts(): Promise<number> {
    return cs.users.countDocuments({ passwordHash: { $exists: true } });
}

export async function findAccount(username: string): Promise<Account | null> {
    if (!username) return null;
    return cs.users.findOne({
        username: normalizeUsername(username),
        passwordHash: { $exists: true },
    });
}

export async function createAccount(
    username: string,
    password: string
): Promise<Account> {
    const now = new Date();
    const account: Account = {
        _id: crypto.randomUUID(),
        username: normalizeUsername(username),
        passwordHash: await hashPassword(password),
        role: 'admin',
        createdAt: now,
        passwordUpdatedAt: now,
    };
    await cs.users.insertOne(account);
    return account;
}

/** Returns the account when the credentials match, `null` otherwise. */
export async function verifyAccount(
    username: string,
    password: string
): Promise<Account | null> {
    const account = await findAccount(username);
    if (!account) {
        // Spend the same scrypt time as a real check (no user enumeration).
        await verifyPassword(password, await getDummyHash());
        return null;
    }
    const ok = await verifyPassword(password, account.passwordHash);
    return ok ? account : null;
}

export async function setAccountPassword(username: string, password: string) {
    await cs.users.updateOne(
        { username: normalizeUsername(username) },
        {
            $set: {
                passwordHash: await hashPassword(password),
                passwordUpdatedAt: new Date(),
            },
        }
    );
}

/**
 * Lockout recovery: `AUTH_BOOTSTRAP_USER` + `AUTH_BOOTSTRAP_PASSWORD` create
 * the account at boot when it does not exist. Set `AUTH_BOOTSTRAP_FORCE=true`
 * to reset its password on every start (explicit, never implicit).
 */
export async function bootstrapAccountFromEnv() {
    const username = process.env.AUTH_BOOTSTRAP_USER;
    const password = process.env.AUTH_BOOTSTRAP_PASSWORD;
    if (!username || !password) return;

    const existing = await findAccount(username);
    if (!existing) {
        await createAccount(username, password);
        console.log(
            `[auth] bootstrap account "${normalizeUsername(username)}" created`
        );
        return;
    }
    if (process.env.AUTH_BOOTSTRAP_FORCE === 'true') {
        await setAccountPassword(username, password);
        console.log(
            `[auth] bootstrap account "${normalizeUsername(username)}" password reset`
        );
    }
}

// ---- API tokens (sessions and named app registrations)

export async function createTokenRecord({
    name,
    kind,
    user,
}: {
    name?: string;
    kind: TokenKind;
    user: string;
}): Promise<{ raw: string; record: ApiTokenRecord }> {
    const raw = createRawToken();
    const record: ApiTokenRecord = {
        _id: crypto.randomUUID(),
        name: (name ?? '').trim() || (kind === 'session' ? 'Web UI' : 'API token'),
        kind,
        tokenHash: hashToken(raw),
        prefix: tokenDisplayPrefix(raw),
        user,
        createdAt: new Date(),
        lastUsedAt: null,
        expiresAt: null,
    };
    await cs.apiTokens.insertOne(record);
    return { raw, record };
}

export async function findTokenByRaw(
    raw: string
): Promise<ApiTokenRecord | null> {
    if (!raw) return null;
    const record = await cs.apiTokens.findOne({ tokenHash: hashToken(raw) });
    if (!record) return null;
    if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
        return null;
    }
    return record;
}

export async function listTokens(): Promise<ApiTokenInfo[]> {
    const records: ApiTokenRecord[] = await cs.apiTokens
        .find({})
        .sort({ createdAt: -1 })
        .toArray();

    return records.map(({ tokenHash, ...info }) => info);
}

export async function revokeToken(id: string): Promise<boolean> {
    if (!id) return false;
    const result = await cs.apiTokens.deleteOne({ _id: id });
    return (result?.deletedCount ?? 0) > 0;
}

export async function revokeOtherSessions(user: string, keepId?: string) {
    const query: any = { user, kind: 'session' };
    if (keepId) query._id = { $ne: keepId };
    await cs.apiTokens.deleteMany(query);
}

/**
 * `lastUsedAt` is written at most once every 5 minutes per token: an
 * authenticated request must not cost a Mongo write.
 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const lastTouch = new Map<string, number>();

export async function touchToken(record: ApiTokenRecord) {
    const now = Date.now();
    if ((lastTouch.get(record._id) ?? 0) + TOUCH_INTERVAL_MS > now) return;
    lastTouch.set(record._id, now);
    try {
        await cs.apiTokens.updateOne(
            { _id: record._id },
            { $set: { lastUsedAt: new Date() } }
        );
    } catch (e: any) {
        // Telemetry only: never fail an authenticated request on it.
        console.error('[auth] failed to update lastUsedAt:', e?.message ?? e);
    }
}
