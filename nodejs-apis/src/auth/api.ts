import { HttpError, UnauthorizedError } from '../errors';
import { settings } from '../manager/services/settings';
import { AuthPrincipal, RestApis } from '../types';
import { verifyPassword } from './crypto';
import { authenticateToken, readBearerToken } from './middleware';
import {
    checkLoginRate,
    clearLoginFailures,
    recordLoginFailure,
} from './rate-limit';
import {
    countAccounts,
    createAccount,
    createTokenRecord,
    findAccount,
    listTokens,
    normalizeUsername,
    revokeOtherSessions,
    revokeToken,
    setAccountPassword,
    verifyAccount,
} from './store';

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const MIN_PASSWORD_LENGTH = 8;

function readUsername(body: any): string {
    const username = normalizeUsername(body?.username ?? '');
    if (!USERNAME_RE.test(username)) {
        throw new HttpError(
            400,
            'Username must be 3-32 characters: letters, digits, dot, dash or underscore.'
        );
    }
    return username;
}

function readNewPassword(body: any, field = 'password'): string {
    const password = typeof body?.[field] === 'string' ? body[field] : '';
    if (password.length < MIN_PASSWORD_LENGTH) {
        throw new HttpError(
            400,
            `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
        );
    }
    return password;
}

function requirePrincipal(user?: AuthPrincipal): AuthPrincipal {
    if (!user) throw new UnauthorizedError('Sign in to manage protection');
    return user;
}

function clientIp(params: any): string {
    return params?.socket?.remoteAddress ?? params?.ip ?? 'unknown';
}

const routes: RestApis = {
    'auth/status': {
        get: {
            handler: async ({ headers }) => {
                const raw = readBearerToken(headers);
                const principal = raw ? await authenticateToken(raw) : null;
                const hasAccount = (await countAccounts()) > 0;
                const enabled = !!settings.auth?.enabled;
                return {
                    enabled,
                    authenticated: !!principal,
                    // Enabled but nobody to sign in as: the UI offers a
                    // one-time account creation form instead of a login form.
                    setupRequired: enabled && !hasAccount,
                    hasAccount,
                    user: principal?.user ?? null,
                };
            },
            description: 'Protection status (public)',
        },
    },
    'auth/setup': {
        post: {
            handler: async ({ body }) => {
                if ((await countAccounts()) > 0) {
                    throw new HttpError(
                        409,
                        'An account already exists. Sign in instead.'
                    );
                }
                const username = readUsername(body);
                const password = readNewPassword(body);
                const account = await createAccount(username, password);
                const { raw } = await createTokenRecord({
                    kind: 'session',
                    name: 'Web UI',
                    user: account.username,
                });
                return { token: raw, user: account.username };
            },
            description: 'Create the first administrator account (public)',
        },
    },
    'auth/login': {
        post: {
            handler: async (params) => {
                const { body } = params;
                const username = normalizeUsername(body?.username ?? '');
                const password =
                    typeof body?.password === 'string' ? body.password : '';
                const ip = clientIp(params);
                const userKey = `user|${username}|${ip}`;
                const ipKey = `ip|${ip}`;

                const blocked = [checkLoginRate(userKey), checkLoginRate(ipKey)]
                    .filter((state) => state.blocked)
                    .sort(
                        (a, b) => b.retryAfterSeconds - a.retryAfterSeconds
                    )[0];
                if (blocked) {
                    throw new HttpError(
                        429,
                        `Too many failed attempts. Try again in ${blocked.retryAfterSeconds}s.`
                    );
                }

                const account = await verifyAccount(username, password);
                if (!account) {
                    recordLoginFailure(userKey);
                    // A shared IP (nginx) gets a larger budget so five bad
                    // guesses on one account cannot lock the household out.
                    recordLoginFailure(ipKey, 20);
                    throw new UnauthorizedError('Invalid username or password');
                }

                clearLoginFailures(userKey);
                clearLoginFailures(ipKey);
                const { raw } = await createTokenRecord({
                    kind: 'session',
                    name: 'Web UI',
                    user: account.username,
                });
                return { token: raw, user: account.username };
            },
            description: 'Sign in and receive a long-lived session token',
        },
    },
    'auth/logout': {
        post: {
            handler: async ({ user }) => {
                if (user?.tokenId) await revokeToken(user.tokenId);
            },
            description: 'Revoke the token used by this request',
        },
    },
    'auth/password': {
        post: {
            handler: async ({ body, user }) => {
                const principal = requirePrincipal(user);
                const currentPassword =
                    typeof body?.currentPassword === 'string'
                        ? body.currentPassword
                        : '';
                const newPassword = readNewPassword(body, 'newPassword');
                const account = await findAccount(principal.user);

                if (
                    !account ||
                    !(await verifyPassword(
                        currentPassword,
                        account.passwordHash
                    ))
                ) {
                    throw new UnauthorizedError(
                        'Current password is incorrect'
                    );
                }

                await setAccountPassword(account.username, newPassword);
                // A password change signs out every other browser session.
                await revokeOtherSessions(account.username, principal.tokenId);
                return { ok: true };
            },
            description: 'Change the account password',
        },
    },
    'auth/tokens': {
        get: {
            handler: async ({ user }) => {
                requirePrincipal(user);
                return { tokens: await listTokens() };
            },
            description: 'List API tokens (never the secret)',
        },
        post: {
            handler: async ({ body, user }) => {
                const principal = requirePrincipal(user);
                const name =
                    typeof body?.name === 'string' ? body.name.trim() : '';
                if (!name || name.length > 60) {
                    throw new HttpError(
                        400,
                        'Give the token a name (1-60 characters), e.g. "Node-RED".'
                    );
                }
                const { raw, record } = await createTokenRecord({
                    kind: 'api',
                    name,
                    user: principal.user,
                });
                // Shown once: only the hash is stored.
                return {
                    token: raw,
                    id: record._id,
                    name: record.name,
                    prefix: record.prefix,
                    createdAt: record.createdAt,
                };
            },
            description: 'Register an app and receive its token once',
        },
    },
    'auth/tokens/:id': {
        delete: {
            handler: async ({ params, user }) => {
                requirePrincipal(user);
                await revokeToken(params.id);
                return { ok: true };
            },
            description: 'Revoke an API token',
        },
    },
};

export default routes;


