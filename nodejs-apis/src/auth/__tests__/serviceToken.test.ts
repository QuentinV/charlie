/**
 * Service tokens: the brain mints a token for a co-located service and writes
 * its plaintext to `.private/`. Mongo is replaced by an in-memory collection and
 * the token dir by a temp path, so the suite runs without a database or files.
 */
jest.mock('../../core/db', () => {
    const state: { apiTokens: any[] } = { apiTokens: [] };
    const matches = (doc: any, query: any = {}) =>
        Object.entries(query).every(([key, value]) => doc[key] === value);

    return {
        __state: state,
        cs: {
            apiTokens: {
                insertOne: async (doc: any) => {
                    state.apiTokens.push(doc);
                    return { insertedId: doc._id };
                },
                findOne: async (query: any) =>
                    state.apiTokens.find((d) => matches(d, query)) ?? null,
                deleteMany: async (query: any) => {
                    const keep = state.apiTokens.filter((d) => !matches(d, query));
                    const deletedCount = state.apiTokens.length - keep.length;
                    state.apiTokens.length = 0;
                    state.apiTokens.push(...keep);
                    return { deletedCount };
                },
            },
        },
    };
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureServiceToken, readTokenFile } from '../serviceToken';
import { hashToken } from '../crypto';

const dbState = (jest.requireMock('../../core/db') as any).__state;
const dir = path.join(os.tmpdir(), `charlie-private-${process.pid}`);

beforeEach(() => {
    dbState.apiTokens.length = 0;
    fs.rmSync(dir, { recursive: true, force: true });
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('ensureServiceToken', () => {
    it('writes a chk_ token whose hash is the stored record', async () => {
        const raw = await ensureServiceToken('vision-feed', dir);

        expect(raw.startsWith('chk_')).toBe(true);
        expect(readTokenFile(path.join(dir, 'vision-feed.token'))).toBe(raw);
        expect(dbState.apiTokens).toHaveLength(1);
        expect(dbState.apiTokens[0].tokenHash).toBe(hashToken(raw));
        expect(dbState.apiTokens[0].name).toBe('vision-feed');
        expect(dbState.apiTokens[0].kind).toBe('api');
    });

    it('is idempotent: reuses a still-valid token', async () => {
        const first = await ensureServiceToken('vision-feed', dir);
        const second = await ensureServiceToken('vision-feed', dir);

        expect(second).toBe(first);
        expect(dbState.apiTokens).toHaveLength(1);
    });

    it('re-mints and prunes the old record when the file is gone', async () => {
        const first = await ensureServiceToken('vision-feed', dir);
        fs.rmSync(path.join(dir, 'vision-feed.token'));

        const second = await ensureServiceToken('vision-feed', dir);
        expect(second).not.toBe(first);
        expect(dbState.apiTokens).toHaveLength(1);
        expect(dbState.apiTokens[0].tokenHash).toBe(hashToken(second));
    });
});
