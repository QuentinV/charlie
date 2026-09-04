import 'dotenv/config';
import WebSocket from 'ws';

// =====================================================================
// Home Assistant client (REST + WebSocket)
// ---------------------------------------------------------------
// Environment:
//   HA_HOST  - HA host (default: homeassistant — the compose service name)
//   HA_PORT  - HA port (default: 8123)
//
// The brain authenticates to HA exclusively via the `trusted_networks`
// auth provider. The Bearer access token is ephemeral: it lives only in
// memory and is re-provisioned automatically by haBootstrap.ts (on boot
// and on 401). Nothing is configured, stored or persisted — zero user
// involvement.
// =====================================================================

const HA_HOST = process.env.HA_HOST ?? 'homeassistant';
const HA_PORT = process.env.HA_PORT ?? '8123';

export const haBaseUrl = `http://${HA_HOST}:${HA_PORT}`;
export const HA_HOSTNAME = HA_HOST;

export const HA_CLIENT_ID = 'https://charlie.local/';
export const HA_REDIRECT_URI = 'https://charlie.local/auth/callback';

// Bearer access token, ephemeral (in-memory only).
let haAccessToken = '';
let haClientId = HA_CLIENT_ID;

type Reprovision = () => Promise<boolean>;

let reprovision: Reprovision | null = null;

/**
 * Register the session re-provision callback. haSync sets this to `haBootstrap`
 * so that on a 401 the brain silently mints a fresh ephemeral token again
 * from the trusted network (no refresh token, no persistence anywhere).
 */
export function setHaReprovision(cb: Reprovision): void {
    reprovision = cb;
}

export function setHaClientId(clientId: string): void {
    haClientId = clientId;
}

export function getHaToken(): string {
    return haAccessToken;
}

export function setHaToken(token: string): void {
    haAccessToken = token;
}

export function isHaConfigured(): boolean {
    return !!haAccessToken;
}

/**
 * Force a fresh session from the trusted network. Clears the stale token
 * first so `haBootstrap` actually re-runs (its fast path skips when a token
 * is already present).
 */
export async function ensureHaSession(): Promise<boolean> {
    if (!reprovision) return false;
    haAccessToken = '';
    try {
        const ok = await reprovision();
        return ok && !!haAccessToken;
    } catch (e) {
        return false;
    }
}
// ===== Raw HTTP =====

export async function haNoAuthRequest(
    path: string,
    init?: RequestInit
): Promise<any> {
    return haRequest(path, init, { useAuth: false });
}

interface HaRequestOptions {
    useAuth?: boolean;
    retried?: boolean;
}

export async function haRequest(
    path: string,
    init: RequestInit = {},
    opts: HaRequestOptions = {}
): Promise<any> {
    const { useAuth = true, retried = false } = opts;
    const token = useAuth ? haAccessToken : '';

    let res: Response;
    try {
        res = await fetch(`${haBaseUrl}${path}`, {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                ...(init.headers ?? {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        });
    } catch (e) {
        throw new Error(
            `Home Assistant unreachable (${haBaseUrl}): ${(e as any)?.message ?? e}`
        );
    }

    if (res.status === 401 && useAuth && !retried) {
        // Trusted-network auth: re-provision an ephemeral session on the fly.
        if (await ensureHaSession()) {
            return haRequest(path, init, { useAuth, retried: true });
        }
    }

    if (res.status === 401) {
        throw new Error(
            'Home Assistant authentication failed — ensure the brain can reach HA from the trusted network to re-provision its session.'
        );
    }
    if (res.status === 404) return null;
    if (res.status === 204) return undefined;
    if (!res.ok) {
        const text = await res.text();
        const err: any = new Error(
            `Home Assistant request failed (${res.status})`
        );
        err.status = res.status;
        err.detail = text;
        err.isHaError = true;
        throw err;
    }

    const text = await res.text();
    if (!text) return undefined;
    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
}

// ===== REST helpers (device API) =====

export const haGetConfig = () => haRequest('/api/config');
export const haGetStates = () => haRequest('/api/states');
export const haGetState = (entityId: string) =>
    haRequest(`/api/states/${entityId}`);
export const haCallService = (domain: string, service: string, data: any) =>
    haRequest(`/api/services/${domain}/${service}`, {
        method: 'POST',
        body: JSON.stringify(data ?? {}),
    });

// ===== Onboarding (pre-auth) =====

export const haGetOnboarding = () => haNoAuthRequest('/api/onboarding');
export const haPostOnboardingUsers = (data: any) =>
    haNoAuthRequest('/api/onboarding/users', {
        method: 'POST',
        body: JSON.stringify(data),
    });
export const haPostOnboardingCoreConfig = (data: any) =>
    haRequest('/api/onboarding/core_config', {
        method: 'POST',
        body: JSON.stringify(data),
    });
export const haPostOnboardingAnalytics = () =>
    haRequest('/api/onboarding/analytics', {
        method: 'POST',
        body: JSON.stringify({}),
    });
export const haPostOnboardingIntegration = (data: any) =>
    haRequest('/api/onboarding/integration', {
        method: 'POST',
        body: JSON.stringify(data),
    });

// OAuth2 token endpoint (form-encoded; used by the bootstrap)
export async function haTokenPost(form: Record<string, string>): Promise<any> {
    const res = await fetch(`${haBaseUrl}/auth/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(form).toString(),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HA token request failed (${res.status}): ${text}`);
    }
    return res.json();
}
// ===== WebSocket API =====

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    timer: NodeJS.Timeout;
}

let wsClient: WebSocket | null = null;
let wsConnected: Promise<void> | null = null;
let wsReconnectTimer: NodeJS.Timeout | null = null;
let wsId = 0;
const pending = new Map<number, PendingRequest>();
const eventHandlers: ((event: any) => void)[] = [];

function onWsMessage(raw: WebSocket.RawData) {
    let msg: any;
    try {
        msg = JSON.parse(raw.toString());
    } catch (e) {
        return;
    }

    if (msg.type === 'result') {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.success === true) {
            p.resolve(msg.result);
        } else {
            p.reject(
                new Error(
                    `HA WS error ${msg.error?.code ?? ''}: ${
                        msg.error?.message ?? 'unknown'
                    }`
                )
            );
        }
        return;
    }

    if (msg.type === 'event') {
        eventHandlers.forEach((h) => h(msg.event));
    }
}

function scheduleWsReconnect() {
    if (wsReconnectTimer || !eventHandlers.length) return;
    wsReconnectTimer = setTimeout(() => {
        wsReconnectTimer = null;
        if (!wsClient) {
            haWsConnect().catch((e) =>
                console.error('[HA] WebSocket reconnect failed', e?.message)
            );
        }
    }, 5000);
}

export async function haWsConnect(): Promise<void> {
    if (wsClient?.readyState === WebSocket.OPEN) return;
    if (wsConnected) return wsConnected;

    wsConnected = new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://${HA_HOST}:${HA_PORT}/api/websocket`);
        wsClient = ws;

        const timeout = setTimeout(() => {
            wsConnected = null;
            reject(new Error('[HA] WebSocket connect timeout'));
        }, 15000);

        ws.on('message', (raw) => {
            let msg: any;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                return;
            }

            if (msg.type === 'auth_required') {
                ws.send(
                    JSON.stringify({ type: 'auth', access_token: getHaToken() })
                );
            } else if (msg.type === 'auth_ok') {
                clearTimeout(timeout);
                ws.on('message', onWsMessage);
                wsConnected = null;
                resolve();
            } else if (msg.type === 'auth_invalid') {
                clearTimeout(timeout);
                ws.close();
                wsClient = null;
                wsConnected = null;
                // The ephemeral session expired: re-provision then retry once.
                ensureHaSession()
                    .then((ok) => {
                        if (ok) return haWsConnect();
                        reject(new Error('[HA] WebSocket auth invalid'));
                        return undefined;
                    })
                    .catch(() => reject(new Error('[HA] WebSocket auth invalid')));
            }
        });

        ws.on('error', (err) => {
            clearTimeout(timeout);
            wsClient = null;
            wsConnected = null;
            reject(err);
        });

        ws.on('close', () => {
            wsClient = null;
            wsConnected = null;
            pending.forEach((p) => {
                clearTimeout(p.timer);
                p.reject(new Error('[HA] WebSocket closed'));
            });
            pending.clear();
            scheduleWsReconnect();
        });
    });

    return wsConnected;
}

export async function haWsRequest(type: string, extra?: object): Promise<any> {
    await haWsConnect();
    const id = ++wsId;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`[HA] WS request ${type} timeout`));
        }, 20000);

        pending.set(id, { resolve, reject, timer });
        (wsClient as WebSocket).send(
            JSON.stringify({ id, type, ...(extra ?? {}) })
        );
    });
}
export const haGetAreas = () => haWsRequest('config/area_registry/list');
export const haGetEntities = () => haWsRequest('config/entity_registry/list');
export const haGetDevices = () => haWsRequest('config/device_registry/list');
export const haGetServices = () => haWsRequest('get_services');

export function haSubscribeEvents(
    eventType: string,
    handler: (event: any) => void
): () => void {
    eventHandlers.push(handler);

    haWsRequest('subscribe_events', { event_type: eventType }).catch((e) =>
        console.error('[HA] subscribe_events failed', e?.message)
    );

    return () => {
        const idx = eventHandlers.indexOf(handler);
        if (idx >= 0) eventHandlers.splice(idx, 1);
    };
}

// ===== Config-flow REST API (integration wizard) =====

export const haListFlowHandlers = () =>
    haRequest('/api/config/config_entries/flow_handlers');

export const haStartFlow = (handler: string, context?: object) =>
    haRequest('/api/config/config_entries/flow', {
        method: 'POST',
        body: JSON.stringify({ handler, ...(context ?? {}) }),
    });

export const haGetFlow = (flowId: string) =>
    haRequest(`/api/config/config_entries/flow/${flowId}`);

export const haAdvanceFlow = (flowId: string, userData: any) =>
    haRequest(`/api/config/config_entries/flow/${flowId}`, {
        method: 'POST',
        body: JSON.stringify(userData ?? {}),
    });

export const haAbortFlow = (flowId: string) =>
    haRequest(`/api/config/config_entries/flow/${flowId}`, {
        method: 'DELETE',
    });

export const haListEntries = () =>
    haRequest('/api/config/config_entries/entry');

export const haDeleteEntry = (entryId: string) =>
    haRequest(`/api/config/config_entries/entry/${entryId}`, {
        method: 'DELETE',
    });