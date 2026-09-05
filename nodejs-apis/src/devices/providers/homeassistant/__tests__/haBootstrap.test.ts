import { haBootstrap, haBootstrapConfig } from '../bootstrap';
import { getHaToken, isHaConfigured, setHaToken } from '../client';
import { haRequest, setHaReprovision } from '../client';

// Mock global.fetch to simulate a fresh HA instance + trusted-network auth.
const fetchMock = jest.fn();
const originalFetch = global.fetch;

const AUTH_CODE = 'test-auth-code';
const ACCESS_TOKEN = 'test-access-token';

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
                    return jsonResponse({ access_token: ACCESS_TOKEN });
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

    test('skips bootstrap when an in-memory session is already present', async () => {
        setHaToken(ACCESS_TOKEN);
        mockFreshInstance();

        const ok = await haBootstrap();
        expect(ok).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('haRequest self-heals a 401 by re-provisioning (trusted net)', async () => {
        // Session is stale; /api/states rejects until the token is refreshed.
        fetchMock.mockImplementation(
            async (input: RequestInfo, init?: RequestInit) => {
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
                    return jsonResponse({
                        type: 'create_entry',
                        flow_id: 'flow-2',
                        result: AUTH_CODE,
                    });
                }
                if (url.endsWith('/auth/token')) {
                    return jsonResponse({ access_token: ACCESS_TOKEN });
                }
                if (url.endsWith('/api/states')) {
                    const headers = (init?.headers ?? {}) as Record<
                        string,
                        string
                    >;
                    if (headers.Authorization === `Bearer ${ACCESS_TOKEN}`) {
                        return jsonResponse([
                            { entity_id: 'light.salon', state: 'on' },
                        ]);
                    }
                    return jsonResponse({}, 401);
                }
                return jsonResponse({}, 404);
            }
        );

        setHaReprovision(() => haBootstrap());
        setHaToken('stale-token');

        const states = await haRequest('/api/states');

        expect(states[0].entity_id).toBe('light.salon');
        expect(getHaToken()).toBe(ACCESS_TOKEN);

        // Ensure the stale session caused a re-provision round-trip.
        const urls = fetchMock.mock.calls.map(
            ([input]: [RequestInfo]) => urlFrom(input)
        );
        expect(urls.filter((u) => u.endsWith('/auth/token'))).toHaveLength(1);
    });
});