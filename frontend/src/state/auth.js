import { createEffect, createEvent, createStore } from 'effector';
import {
    UNAUTHORIZED_EVENT,
    apiStrict,
    clearToken,
    getToken,
    setToken,
} from '../api/charlie';

const EMPTY = {
    enabled: false,
    authenticated: false,
    setupRequired: false,
    hasAccount: false,
    user: null,
};

const $auth = createStore({ ...EMPTY, loading: true });

const sessionExpired = createEvent();
$auth.on(sessionExpired, (state) => ({
    ...state,
    authenticated: false,
    user: null,
}));

/** Probe the public status endpoint (works before any token exists). */
const checkFx = createEffect(async () => {
    const status = await apiStrict('auth/status');
    // Drop a token the server no longer knows about (revoked/expired).
    if (status?.enabled && !status.authenticated && getToken()) clearToken();
    return status;
});
$auth.on(checkFx.doneData, (_, status) => ({
    ...EMPTY,
    ...status,
    loading: false,
}));
$auth.on(checkFx.fail, () => ({ ...EMPTY, loading: false }));

const loginFx = createEffect(async ({ username, password }) => {
    const result = await apiStrict('auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
    });
    setToken(result.token);
    return result;
});
$auth.on(loginFx.doneData, (state, result) => ({
    ...state,
    enabled: true,
    authenticated: true,
    setupRequired: false,
    hasAccount: true,
    user: result.user,
    loading: false,
}));

/** First-run: creates the administrator account and signs this browser in. */
const setupFx = createEffect(async ({ username, password }) => {
    const result = await apiStrict('auth/setup', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
    });
    setToken(result.token);
    return result;
});
$auth.on(setupFx.doneData, (state, result) => ({
    ...state,
    authenticated: true,
    setupRequired: false,
    hasAccount: true,
    user: result.user,
    loading: false,
}));

const logoutFx = createEffect(async () => {
    try {
        await apiStrict('auth/logout', { method: 'POST' });
    } catch {
        // The token may already be revoked: clearing it locally is enough.
    }
    clearToken();
});
$auth.on(logoutFx.done, (state) => ({
    ...state,
    authenticated: false,
    user: null,
}));

if (typeof window !== 'undefined') {
    window.addEventListener(UNAUTHORIZED_EVENT, () => sessionExpired());
}

export const auth = {
    $auth,
    checkFx,
    loginFx,
    setupFx,
    logoutFx,
    sessionExpired,
};
