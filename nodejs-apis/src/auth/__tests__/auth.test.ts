/**
 * Auth unit tests: password hashing, token storage, the HTTP gate and the
 * login throttle. Mongo is replaced by an in-memory collection so the suite
 * runs without a database.
 */

jest.mock('../../core/db', () => {
    const state: { users: any[]; apiTokens: any[] } = {
        users: [],
        apiTokens: [],
    };

    const matches = (doc: any, query: any = {}) =>
        Object.entries(query).every(([key, value]: [string, any]) => {
            if (value && typeof value === 'object' && '$exists' in value) {
                return (doc[key] !== undefined) === value.$exists;
            }
            if (value && typeof value === 'object' && '$ne' in value) {
                return doc[key] !== value.$ne;
            }
            return doc[key] === value;
        });

    const apply = (doc: any, patch: any) => {
        if (patch?.$set) Object.assign(doc, patch.$set);
    };

    return {
        __state: state,
        cs: {
            users: {
                countDocuments: async (query: any) =>
                    state.users.filter((d) => matches(d, query)).length,
                findOne: async (query: any) =>
                    state.users.find((d) => matches(d, query)) ?? null,
                insertOne: async (doc: any) => {
                    state.users.push(doc);
                    return { insertedId: doc._id };
                },
                updateOne: async (query: any, patch: any) => {
                    const doc = state.users.find((d) => matches(d, query));
                    if (doc) apply(doc, patch);
                    return { modifiedCount: doc ? 1 : 0 };
                },
            },
            apiTokens: {
                insertOne: async (doc: any) => {
                    state.apiTokens.push(doc);
                    return { insertedId: doc._id };
                },
                findOne: async (query: any) =>
                    state.apiTokens.find((d) => matches(d, query)) ?? null,
                find: () => ({
                    sort: () => ({
                        toArray: async () =>
                            [...state.apiTokens].sort(
                                (a, b) =>
                                    b.createdAt.getTime() -
                                    a.createdAt.getTime()
                            ),
                    }),
                }),
                updateOne: async (query: any, patch: any) => {
                    const doc = state.apiTokens.find((d) => matches(d, query));
                    if (doc) apply(doc, patch);
                    return { modifiedCount: doc ? 1 : 0 };
                },
                deleteOne: async (query: any) => {
                    const index = state.apiTokens.findIndex((d) =>
                        matches(d, query)
                    );
                    if (index < 0) return { deletedCount: 0 };
                    state.apiTokens.splice(index, 1);
                    return { deletedCount: 1 };
                },
                deleteMany: async (query: any) => {
                    const before = state.apiTokens.length;
                    state.apiTokens = state.apiTokens.filter(
                        (d) => !matches(d, query)
                    );
                    return { deletedCount: before - state.apiTokens.length };
                },
            },
        },
    };
});

jest.mock('../../manager/services/settings', () => ({
    settings: { auth: { enabled: false } },
}));


import * as db from '../../core/db';
import { settings } from '../../manager/services/settings';
import authRoutes from '../api';
import { hashPassword, hashToken, verifyPassword } from '../crypto';
import { authGate, isPublicRoute, readBearerToken } from '../middleware';
import {
    checkLoginRate,
    clearLoginFailures,
    recordLoginFailure,
} from '../rate-limit';
import {
    createAccount,
    createTokenRecord,
    findAccount,
    findTokenByRaw,
    listTokens,
    revokeOtherSessions,
    revokeToken,
    verifyAccount,
} from '../store';

const state = (db as any).__state as {
    users: any[];
    apiTokens: any[];
};

function mockRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = (code: number) => {
        res.statusCode = code;
        return res;
    };
    res.json = (body: any) => {
        res.body = body;
        return res;
    };
    return res;
}

describe('password hashing', () => {
    it('verifies the right password and rejects a wrong one', async () => {
        const hash = await hashPassword('correct horse battery staple');
        expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true);
        await expect(
            verifyPassword('correct horse battery staple', hash)
        ).resolves.toBe(true);
        await expect(verifyPassword('wrong password', hash)).resolves.toBe(
            false
        );
        await expect(verifyPassword('anything', 'not-a-hash')).resolves.toBe(
            false
        );
        await expect(verifyPassword('anything', undefined)).resolves.toBe(
            false
        );
    });

    it('salts every hash', async () => {
        const [a, b] = await Promise.all([
            hashPassword('same-password'),
            hashPassword('same-password'),
        ]);
        expect(a).not.toBe(b);
    });
});

describe('accounts', () => {
    it('creates an account and verifies normalized credentials', async () => {
        await createAccount('Quentin', 'a-long-password');
        const account = await findAccount('  QUENTIN ');
        expect(account?.username).toBe('quentin');

        await expect(
            verifyAccount('quentin', 'a-long-password')
        ).resolves.toBeTruthy();
        await expect(verifyAccount('quentin', 'nope')).resolves.toBeNull();
        await expect(verifyAccount('ghost', 'nope')).resolves.toBeNull();
    });
});

describe('api tokens', () => {
    it('stores only a hash, lists safely and revokes', async () => {
        const { raw, record } = await createTokenRecord({
            kind: 'api',
            name: 'Node-RED',
            user: 'quentin',
        });

        expect(raw.startsWith('chk_')).toBe(true);
        expect(record.tokenHash).toBe(hashToken(raw));

        const found = await findTokenByRaw(raw);
        expect(found?._id).toBe(record._id);

        const listed = await listTokens();
        const item = listed.find((t) => t._id === record._id)!;
        expect(item.name).toBe('Node-RED');
        expect(item).not.toHaveProperty('tokenHash');

        await revokeToken(record._id);
        await expect(findTokenByRaw(raw)).resolves.toBeNull();
    });

    it('rejects an expired token', async () => {
        const { raw, record } = await createTokenRecord({
            kind: 'api',
            name: 'Old app',
            user: 'quentin',
        });
        state.apiTokens.find((t) => t._id === record._id).expiresAt =
            new Date(0);
        await expect(findTokenByRaw(raw)).resolves.toBeNull();
    });

    it('revokes other sessions but keeps the current token', async () => {
        const first = await createTokenRecord({
            kind: 'session',
            user: 'quentin',
        });
        const second = await createTokenRecord({
            kind: 'session',
            user: 'quentin',
        });
        const api = await createTokenRecord({
            kind: 'api',
            name: 'App',
            user: 'quentin',
        });

        await revokeOtherSessions('quentin', first.record._id);

        await expect(findTokenByRaw(first.raw)).resolves.toBeTruthy();
        await expect(findTokenByRaw(second.raw)).resolves.toBeNull();
        // Named app tokens survive a password change.
        await expect(findTokenByRaw(api.raw)).resolves.toBeTruthy();
    });
});



describe('auth gate', () => {
    beforeEach(() => {
        (settings as any).auth = { enabled: false };
    });

    it('is transparent while protection is disabled', async () => {
        const next = jest.fn();
        await authGate(
            { method: 'GET', path: '/api/devices', headers: {} },
            mockRes(),
            next
        );
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('rejects a request without a token with 401', async () => {
        (settings as any).auth = { enabled: true };
        const next = jest.fn();
        const res = mockRes();
        await authGate(
            { method: 'GET', path: '/api/devices', headers: {} },
            res,
            next
        );
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.body.message).toMatch(/Authentication required/);
    });

    it('accepts a valid bearer token and attaches the principal', async () => {
        (settings as any).auth = { enabled: true };
        const { raw, record } = await createTokenRecord({
            kind: 'api',
            name: 'Node-RED',
            user: 'quentin',
        });
        const req: any = {
            method: 'GET',
            path: '/api/devices',
            headers: { authorization: `Bearer ${raw}` },
        };
        const next = jest.fn();

        await authGate(req, mockRes(), next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.user).toEqual({
            user: 'quentin',
            tokenId: record._id,
            name: 'Node-RED',
            kind: 'api',
        });
    });

    it('rejects an unknown token', async () => {
        (settings as any).auth = { enabled: true };
        const next = jest.fn();
        const res = mockRes();
        await authGate(
            {
                method: 'GET',
                path: '/api/devices',
                headers: { authorization: 'Bearer chk_unknown' },
            },
            res,
            next
        );
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });

    it('keeps login, status, setup and device OTA public', () => {
        expect(isPublicRoute('POST', '/api/auth/login')).toBe(true);
        expect(isPublicRoute('GET', '/api/auth/status')).toBe(true);
        expect(isPublicRoute('POST', '/api/auth/setup')).toBe(true);
        expect(
            isPublicRoute('GET', '/api/echo/echo-zero/latest/firmware.bin')
        ).toBe(true);
        expect(isPublicRoute('GET', '/api-docs/')).toBe(true);
        expect(isPublicRoute('OPTIONS', '/api/devices')).toBe(true);
        expect(isPublicRoute('GET', '/api/devices')).toBe(false);
        expect(isPublicRoute('DELETE', '/api/auth/tokens/abc')).toBe(false);
    });
});

describe('bearer parsing', () => {
    it('reads case-insensitive Authorization headers', () => {
        expect(readBearerToken({ Authorization: 'Bearer abc' })).toBe('abc');
        expect(readBearerToken({ authorization: 'bearer xyz ' })).toBe('xyz');
        expect(readBearerToken({ authorization: 'Basic abc' })).toBeNull();
        expect(readBearerToken({})).toBeNull();
    });
});

describe('login throttle', () => {
    it('locks after five failures and clears on success', () => {
        const key = `user|test|${Date.now()}`;
        expect(checkLoginRate(key).blocked).toBe(false);

        for (let i = 0; i < 5; i += 1) recordLoginFailure(key);

        const stateAfter = checkLoginRate(key);
        expect(stateAfter.blocked).toBe(true);
        expect(stateAfter.retryAfterSeconds).toBeGreaterThan(0);

        clearLoginFailures(key);
        expect(checkLoginRate(key).blocked).toBe(false);
    });
});

describe('auth routes', () => {
    type Method = 'get' | 'post' | 'delete';

    const call = async (route: string, method: Method, params: any = {}) => {
        const routeDef: any = (authRoutes as any)[route];
        const endpoint: any = routeDef[method];
        const handler = endpoint.handler ?? endpoint;
        return handler({
            headers: {},
            query: {},
            body: {},
            params: {},
            method: method.toUpperCase(),
            socket: {
                remoteAddress: `10.0.0.${Math.floor(Math.random() * 250)}`,
            },
            ...params,
        });
    };

    const expectHttpError = async (promise: Promise<any>, status: number) => {
        try {
            await promise;
            throw new Error('Expected the handler to reject');
        } catch (e: any) {
            expect(e.httpStatus).toBe(status);
        }
    };

    it('exposes a public status', async () => {
        (settings as any).auth = { enabled: false };
        const status = await call('auth/status', 'get');
        expect(status).toEqual(
            expect.objectContaining({
                enabled: false,
                authenticated: false,
                setupRequired: false,
            })
        );
        expect(typeof status.hasAccount).toBe('boolean');
    });

    it('signs in and manages a named token', async () => {
        (settings as any).auth = { enabled: true };
        // The account was created by the `accounts` suite above.
        const login = await call('auth/login', 'post', {
            body: { username: 'quentin', password: 'a-long-password' },
            socket: { remoteAddress: '10.1.1.1' },
        });
        expect(login.token.startsWith('chk_')).toBe(true);
        expect(login.user).toBe('quentin');

        const record = await findTokenByRaw(login.token);
        const principal = {
            user: 'quentin',
            tokenId: record!._id,
            name: 'Web UI',
            kind: 'session' as const,
        };

        const created = await call('auth/tokens', 'post', {
            body: { name: 'Node-RED' },
            user: principal,
        });
        expect(created.token.startsWith('chk_')).toBe(true);
        expect(created.name).toBe('Node-RED');

        const list = await call('auth/tokens', 'get', { user: principal });
        expect(list.tokens.some((t: any) => t.name === 'Node-RED')).toBe(true);
        expect(list.tokens[0]).not.toHaveProperty('tokenHash');

        await call('auth/tokens/:id', 'delete', {
            params: { id: created.id },
            user: principal,
        });
        await expect(findTokenByRaw(created.token)).resolves.toBeNull();
    });

    it('rejects a wrong password and a second setup', async () => {
        await expectHttpError(
            call('auth/login', 'post', {
                body: { username: 'quentin', password: 'wrong' },
                socket: { remoteAddress: '10.1.1.2' },
            }),
            401
        );
        await expectHttpError(
            call('auth/setup', 'post', {
                body: { username: 'someone', password: 'long-enough' },
                socket: { remoteAddress: '10.1.1.3' },
            }),
            409
        );
    });

    it('requires a principal for token management', async () => {
        await expectHttpError(call('auth/tokens', 'get'), 401);
    });
});
