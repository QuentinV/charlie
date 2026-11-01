import React from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    Divider,
    IconButton,
    List,
    ListItem,
    ListItemText,
    TextField,
    Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useUnit } from 'effector-react';
import { api, apiStrict } from '../../api/charlie';
import { auth } from '../../state/auth';
import { settings } from '../../state/settings';
import { useSettings } from '../../state/settingsHooks';

/**
 * Protection management: enable/disable the login requirement, change the
 * password and register named API tokens.
 */
export function Security() {
    const authState = useUnit(auth.$auth);
    const setup = useUnit(auth.setupFx);
    const currentSettings = useSettings();

    const enabled = !!authState.enabled;
    const hasAccount = !!authState.hasAccount;

    const [username, setUsername] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [confirm, setConfirm] = React.useState('');
    const [currentPassword, setCurrentPassword] = React.useState('');
    const [newPassword, setNewPassword] = React.useState('');
    const [tokenName, setTokenName] = React.useState('');
    const [tokens, setTokens] = React.useState([]);
    const [createdToken, setCreatedToken] = React.useState(null);
    const [error, setError] = React.useState(null);
    const [info, setInfo] = React.useState(null);
    const [busy, setBusy] = React.useState(false);

    /** Persist `auth.enabled` and refresh the live settings cache. */
    const setProtection = async (value) => {
        await apiStrict('settings', {
            method: 'PUT',
            body: JSON.stringify({ 'auth.enabled': value }),
        });
        settings.update({ ...currentSettings, 'auth.enabled': value });
        await auth.checkFx();
    };

    const loadTokens = React.useCallback(async () => {
        if (!enabled) {
            setTokens([]);
            return;
        }
        const res = await api('auth/tokens');
        setTokens(res?.tokens ?? []);
    }, [enabled]);

    React.useEffect(() => {
        loadTokens().catch(() => setTokens([]));
    }, [loadTokens]);

    const createAccountAndEnable = async () => {
        setError(null);
        setInfo(null);
        if (password !== confirm) {
            setError('Passwords do not match.');
            return;
        }
        if (password.length < 8) {
            setError('Password must be at least 8 characters.');
            return;
        }

        setBusy(true);
        try {
            // Account first, then the flag: a failed account creation must
            // never leave the API locked with nobody able to sign in.
            await setup({ username, password });
            await setProtection(true);
            setUsername('');
            setPassword('');
            setConfirm('');
            setInfo(
                'Protection is enabled. This browser stays signed in; create an API token for other apps.'
            );
        } catch (e) {
            setError(e?.message ?? 'Unable to enable protection.');
        } finally {
            setBusy(false);
        }
    };


    const changePassword = async () => {
        setError(null);
        setInfo(null);
        setBusy(true);
        try {
            await apiStrict('auth/password', {
                method: 'POST',
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            setCurrentPassword('');
            setNewPassword('');
            setInfo('Password updated. Other browser sessions were signed out.');
        } catch (e) {
            setError(e?.message ?? 'Unable to update the password.');
        } finally {
            setBusy(false);
        }
    };

    const createToken = async () => {
        setError(null);
        setInfo(null);
        const name = tokenName.trim();
        if (!name) {
            setError('Give the token a name, e.g. "Node-RED".');
            return;
        }
        setBusy(true);
        try {
            const res = await apiStrict('auth/tokens', {
                method: 'POST',
                body: JSON.stringify({ name }),
            });
            setCreatedToken(res.token);
            setTokenName('');
            await loadTokens();
        } catch (e) {
            setError(e?.message ?? 'Unable to create the token.');
        } finally {
            setBusy(false);
        }
    };

    const revoke = async (id) => {
        if (!window.confirm('Revoke this token? Apps using it will stop working.')) {
            return;
        }
        try {
            await apiStrict(`auth/tokens/${id}`, { method: 'DELETE' });
            await loadTokens();
        } catch (e) {
            setError(e?.message ?? 'Unable to revoke the token.');
        }
    };

    const copyToken = async () => {
        try {
            await navigator.clipboard.writeText(createdToken);
            setInfo('Token copied to clipboard.');
        } catch {
            // Clipboard unavailable (insecure context): the text is visible.
        }
    };

    const enableExistingAccount = async () => {
        setError(null);
        setInfo(null);
        setBusy(true);
        try {
            await setProtection(true);
            setInfo(
                'Protection is enabled. Sign in with your existing account to continue.'
            );
        } catch (e) {
            setError(e?.message ?? 'Unable to enable protection.');
        } finally {
            setBusy(false);
        }
    };

    const disableProtection = async () => {
        if (
            !window.confirm(
                'Disable login and API token protection? Anyone who can reach the Charlie API will be able to control it.'
            )
        ) {
            return;
        }
        setError(null);
        setInfo(null);
        setBusy(true);
        try {
            await setProtection(false);
            setInfo('Protection is disabled.');
        } catch (e) {
            setError(e?.message ?? 'Unable to disable protection.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}>
            <Box>
                <Typography variant="h6">Security</Typography>
                <Typography variant="body2" color="text.secondary">
                    Login, password and API tokens for the Charlie brain.
                </Typography>
            </Box>

            {error && (
                <Alert severity="error" onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}
            {info && (
                <Alert severity="success" onClose={() => setInfo(null)}>
                    {info}
                </Alert>
            )}

            {!enabled && !hasAccount && (
                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1.5,
                    }}
                >
                    <Alert severity="info">
                        The API is currently open to anyone who can reach this
                        server. Create an administrator account to require a
                        login and API tokens.
                    </Alert>
                    <TextField
                        label="Username"
                        size="small"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        autoComplete="username"
                    />
                    <TextField
                        label="Password"
                        size="small"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        helperText="At least 8 characters."
                    />
                    <TextField
                        label="Confirm password"
                        size="small"
                        type="password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        autoComplete="new-password"
                    />
                    <Box>
                        <Button
                            variant="contained"
                            disabled={busy || !username || !password}
                            onClick={createAccountAndEnable}
                        >
                            Create account and enable protection
                        </Button>
                    </Box>
                </Box>
            )}

            {!enabled && hasAccount && (
                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1.5,
                    }}
                >
                    <Alert severity="warning">
                        Protection is off. An account already exists; enabling
                        protection will ask you to sign in.
                    </Alert>
                    <Box>
                        <Button
                            variant="contained"
                            disabled={busy}
                            onClick={enableExistingAccount}
                        >
                            Enable protection
                        </Button>
                    </Box>
                </Box>
            )}

            {enabled && (
                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1.5,
                    }}
                >
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            flexWrap: 'wrap',
                        }}
                    >
                        <Chip
                            color="success"
                            label="Protection enabled"
                            size="small"
                        />
                        {authState.user && (
                            <Typography variant="body2">
                                Signed in as <strong>{authState.user}</strong>
                            </Typography>
                        )}
                        <Button
                            size="small"
                            color="warning"
                            disabled={busy}
                            onClick={disableProtection}
                        >
                            Disable protection
                        </Button>
                    </Box>

                    <Divider />
                    <Typography variant="subtitle1">
                        Change password
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <TextField
                            label="Current password"
                            size="small"
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            autoComplete="current-password"
                        />
                        <TextField
                            label="New password"
                            size="small"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            autoComplete="new-password"
                        />
                        <Button
                            variant="outlined"
                            disabled={busy || !currentPassword || !newPassword}
                            onClick={changePassword}
                        >
                            Update
                        </Button>
                    </Box>

                    <Divider />
                    <Typography variant="subtitle1">API tokens</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Register an app by name (Node-RED, a script, Home
                        Assistant…) and copy its token once.
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <TextField
                            label="App name"
                            size="small"
                            value={tokenName}
                            onChange={(e) => setTokenName(e.target.value)}
                        />
                        <Button
                            variant="contained"
                            disabled={busy || !tokenName.trim()}
                            onClick={createToken}
                        >
                            Create token
                        </Button>
                    </Box>

                    {createdToken && (
                        <Alert
                            severity="warning"
                            onClose={() => setCreatedToken(null)}
                        >
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                Copy this token now — it will not be shown
                                again:
                            </Typography>
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                }}
                            >
                                <Typography
                                    variant="body2"
                                    sx={{
                                        fontFamily: 'monospace',
                                        wordBreak: 'break-all',
                                        flexGrow: 1,
                                    }}
                                >
                                    {createdToken}
                                </Typography>
                                <IconButton
                                    size="small"
                                    onClick={copyToken}
                                    aria-label="Copy token"
                                >
                                    <ContentCopyIcon fontSize="small" />
                                </IconButton>
                            </Box>
                        </Alert>
                    )}

                    <List dense>
                        {tokens.map((token) => (
                            <ListItem
                                key={token._id}
                                secondaryAction={
                                    <IconButton
                                        edge="end"
                                        aria-label="Revoke token"
                                        onClick={() => revoke(token._id)}
                                    >
                                        <DeleteIcon />
                                    </IconButton>
                                }
                            >
                                <ListItemText
                                    primary={`${token.name} — ${token.prefix}…`}
                                    secondary={`${
                                        token.kind === 'session'
                                            ? 'Browser session'
                                            : 'API token'
                                    } · created ${new Date(
                                        token.createdAt
                                    ).toLocaleString()}${
                                        token.lastUsedAt
                                            ? ` · last used ${new Date(
                                                  token.lastUsedAt
                                              ).toLocaleString()}`
                                            : ' · never used'
                                    }`}
                                />
                            </ListItem>
                        ))}
                        {!tokens.length && (
                            <ListItem>
                                <ListItemText primary="No tokens yet." />
                            </ListItem>
                        )}
                    </List>

                </Box>
            )}
        </Box>
    );
}

