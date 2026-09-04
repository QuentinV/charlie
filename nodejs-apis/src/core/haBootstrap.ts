import 'dotenv/config';
import {
    getHaToken,
    haGetOnboarding,
    haNoAuthRequest,
    haPostOnboardingAnalytics,
    haPostOnboardingCoreConfig,
    haPostOnboardingIntegration,
    haPostOnboardingUsers,
    haTokenPost,
    setHaClientId,
    setHaToken,
} from './ha';

// =====================================================================
// Home Assistant zero-touch bootstrap — network auth only.
// ---------------------------------------------------------------
// The brain authenticates to HA exclusively via the `trusted_networks`
// auth provider (allow_bypass_login). There is intentionally NO
// username/password login fallback: if the request does not come from a
// trusted network, we fail with a clear message.
//
// Flow (idempotent, access token is IN-MEMORY only):
//   1. wait for HA API readiness (retry loop)
//   2. GET /api/onboarding -> done steps
//   3. if "user" not done: POST /api/onboarding/users to create the SINGLE
//      owner user (guarantees allow_bypass_login has exactly one user).
//   4. POST /auth/login_flow (handler trusted_networks) -> create_entry with
//      an auth_code (no credentials required from a trusted network).
//   5. POST /auth/token (authorization_code grant) -> access token.
//   6. Complete remaining onboarding steps (core_config, analytics,
//      integration) idempotently.
//   7. The token is only kept in memory (ha.ts). On the next boot — or on
//      a 401 — this runs again. Nothing is stored or persisted.
// =====================================================================

export const haBootstrapConfig = {
    enabled: (process.env.HA_AUTO_PROVISION ?? 'true') !== 'false',
    clientId: process.env.HA_CLIENT_ID ?? 'https://charlie.local/',
    redirectUri:
        process.env.HA_REDIRECT_URI ?? 'https://charlie.local/auth/callback',
    onboarding: {
        name: process.env.HA_ONBOARD_NAME ?? 'Charlie',
        username: process.env.HA_ONBOARD_USERNAME ?? 'charlie',
        password: process.env.HA_ONBOARD_PASSWORD ?? 'charlie',
        language: process.env.HA_LANGUAGE ?? 'fr',
    },
    locationName: process.env.HA_LOCATION_NAME ?? 'Charlie Home',
    latitude: process.env.HA_LATITUDE
        ? Number(process.env.HA_LATITUDE)
        : 46.2276,
    longitude: process.env.HA_LONGITUDE
        ? Number(process.env.HA_LONGITUDE)
        : 2.2137,
    timeZone: process.env.HA_TIME_ZONE ?? 'Europe/Paris',
};

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitForHa(attempts = 30, delayMs = 2000): Promise<boolean> {
    for (let i = 0; i < attempts; ++i) {
        try {
            await haGetOnboarding();
            return true;
        } catch (e) {
            console.log(
                `[HA] waiting for API readiness (${i + 1}/${attempts})…`
            );
            await sleep(delayMs);
        }
    }
    return false;
}

async function getDoneSteps(): Promise<string[]> {
    const data = await haGetOnboarding();
    if (!Array.isArray(data)) return [];
    return data.filter((s) => s?.done).map((s) => s.step);
}

/** Extract the authorization code from a login-flow / onboarding response. */
function extractAuthCode(res: any): string | undefined {
    if (!res) return undefined;
    if (typeof res.result === 'string') return res.result;
    if (res.auth_code) return res.auth_code;
    return undefined;
}
async function trustedNetworksLogin(): Promise<string> {
    const res = await haNoAuthRequest('/auth/login_flow', {
        method: 'POST',
        body: JSON.stringify({
            client_id: haBootstrapConfig.clientId,
            handler: ['trusted_networks', null],
            redirect_uri: haBootstrapConfig.redirectUri,
        }),
    });

    if (res?.type === 'create_entry') {
        const code = extractAuthCode(res);
        if (code) return code;
    }

    throw new Error(
        '[HA] trusted_networks login failed — is the brain on the trusted network? ' +
            `(Response: ${JSON.stringify(res ?? null)})`
    );
}

async function onboardUserIfNeeded(done: string[]): Promise<void> {
    if (done.includes('user')) return;
    try {
        await haPostOnboardingUsers({
            client_id: haBootstrapConfig.clientId,
            name: haBootstrapConfig.onboarding.name,
            username: haBootstrapConfig.onboarding.username,
            password: haBootstrapConfig.onboarding.password,
            language: haBootstrapConfig.onboarding.language,
        });
        console.log('[HA] owner user onboarded');
    } catch (e) {
        console.error(
            '[HA] onboarding/users failed (assuming an existing user):',
            (e as any)?.message ?? e
        );
    }
}

async function completeRemainingOnboarding(done: string[]): Promise<void> {
    if (!done.includes('core_config')) {
        await haPostOnboardingCoreConfig({
            location_name: haBootstrapConfig.locationName,
            latitude: haBootstrapConfig.latitude,
            longitude: haBootstrapConfig.longitude,
            time_zone: haBootstrapConfig.timeZone,
            unit_system: 'metric',
        });
    }
    if (!done.includes('analytics')) {
        await haPostOnboardingAnalytics();
    }
    if (!done.includes('integration')) {
        await haPostOnboardingIntegration({
            client_id: haBootstrapConfig.clientId,
            redirect_uri: haBootstrapConfig.redirectUri,
        });
    }
}

export async function haBootstrap(): Promise<boolean> {
    if (!haBootstrapConfig.enabled) {
        console.log('[HA] auto-provision disabled (HA_AUTO_PROVISION=false)');
        return false;
    }
    if (getHaToken()) {
        console.log('[HA] session already provisioned, skipping bootstrap');
        return true;
    }

    // Make token refresh use the same client id we authenticate with.
    setHaClientId(haBootstrapConfig.clientId);

    const ready = await waitForHa();
    if (!ready) {
        console.error('[HA] bootstrap aborted: Home Assistant not reachable.');
        return false;
    }

    try {
        const done = await getDoneSteps();
        await onboardUserIfNeeded(done);

        const code = await trustedNetworksLogin();
        const cfg = haBootstrapConfig;
        const { access_token } = await haTokenPost({
            client_id: cfg.clientId,
            grant_type: 'authorization_code',
            code,
        });

        if (!access_token) {
            throw new Error('[HA] token exchange returned no access_token');
        }

        setHaToken(access_token);

        // Re-derive remaining steps (user creation may have flipped 'done').
        const freshDone = await getDoneSteps();
        await completeRemainingOnboarding(freshDone);

        console.log('[HA] bootstrap done (trusted networks)');
        return true;
    } catch (e) {
        console.error('[HA] bootstrap failed:', (e as any)?.message ?? e);
        return false;
    }
}