import { haBootstrap, haBootstrapConfig } from '../haBootstrap';
import {
    getHaRefreshToken,
    getHaToken,
    isHaConfigured,
    setHaRefreshToken,
    setHaToken,
} from '../ha';

// Mock global.fetch to simulate a fresh HA instance + trusted-network auth.
const fetchMock = jest.fn();
const originalFetch = global.fetch;

const AUTH_CODE = 'test-auth-code';
const ACCESS_TOKEN = 'test-access-token';
const REFRESH_TOKEN = 'test-refresh-token';

function jsonResponse(body: any, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as Response;
}

function urlFrom(input: RequestInfo | URL): string {
    return typeof input === 'string' ? input : input.toString();
}

/** Default mock: fresh instance, trusted-networks auth works. */
function mockFreshInstance() {
    fetchMock.mockImplementation(
        async (input: RequestInfo, init?: RequestInit) => {
            const url = urlFrom(input);
            if (url.endsWith('/api/onboarding')) {
                return jsonResponse([
                    { step: 'user', done: false },
                    { step: 'core_config', done: false },
                    { step: 'analytics', done: false },
                    { step: 'integration', done: false },
                ]);
            }
            if (url.endsWith('/api/onboarding/users')) {
                return jsonResponse({});
            }
            if (url.endsWith('/auth/login_flow')) {
                return jsonResponse({
                    type: 'create_entry',
                    flow_id: 'flow-1',
                    result: AUTH_CODE,
                });
            }
            if (url.endsWith('/auth/token')) {
                const form = init?.body?.toString() ?? '';
                if (form.includes('authorization_code')) {
                    return jsonResponse({
                        access_token: ACCESS_TOKEN,
                        refresh_token: REFRESH_TOKEN,
                    });
                }
                return jsonResponse({}, 400);
            }
            if (
                url.endsWith('/api/onboarding/core_config') ||
                url.endsWith('/api/onboarding/analytics') ||
                url.endsWith('/api/onboarding/integration')
            ) {
                const headers = (init?.headers ?? {}) as Record<string, string>;
                if (headers.Authorization) return jsonResponse({});
                return jsonResponse({}, 401);
            }
            return jsonResponse({}, 404);
        }
    );
}

beforeEach(() => {
    (global as any).fetch = fetchMock;
    fetchMock.mockReset();
    setHaToken('');
    setHaRefreshToken('');
    haBootstrapConfig.enabled = true;
});

afterAll(() => {
    (global as any).fetch = originalFetch;
});

describe('haBootstrap (trusted-network auth)', () => {
    test('provisions a fresh HA instance end-to-end', async () => {
        mockFreshInstance();

        const ok = await haBootstrap();

        expect(ok).toBe(true);
        expect(getHaToken()).toBe(ACCESS_TOKEN);
        expect(getHaRefreshToken()).toBe(REFRESH_TOKEN);
        expect(isHaConfigured()).toBe(true);

        const urls = fetchMock.mock.calls.map(
            ([input]: [RequestInfo]) => urlFrom(input)
        );
        const called = (path: string) => urls.some((u) => u.endsWith(path));
        expect(called('/api/onboarding/users')).toBe(true);
        expect(called('/auth/login_flow')).toBe(true);
        expect(called('/auth/token')).toBe(true);
        expect(called('/api/onboarding/core_config')).toBe(true);
        expect(called('/api/onboarding/analytics')).toBe(true);
        expect(called('/api/onboarding/integration')).toBe(true);
    });

    test('returns false when trusted_networks login is not allowed', async () => {
        fetchMock.mockImplementation(async (input: RequestInfo) => {
            const url = urlFrom(input);
            if (url.endsWith('/api/onboarding')) {
                return jsonResponse([
                    { step: 'user', done: true },
                    { step: 'core_config', done: true },
                    { step: 'analytics', done: true },
                    { step: 'integration', done: true },
                ]);
            }
            if (url.endsWith('/auth/login_flow')) {
                return jsonResponse({ type: 'abort', reason: 'not_allowed' });
            }
            return jsonResponse({}, 404);
        });

        const ok = await haBootstrap();
        expect(ok).toBe(false);
        expect(isHaConfigured()).toBe(false);
    });

    test('skips bootstrap when a token is already configured', async () => {
        setHaToken('env-token');
        mockFreshInstance();

        const ok = await haBootstrap();
        expect(ok).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});