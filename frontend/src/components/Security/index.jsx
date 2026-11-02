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
import { useTranslation } from 'react-i18next';
import { api, apiStrict } from '../../api/charlie';
import { auth } from '../../state/auth';
import { settings } from '../../state/settings';
import { useSettings } from '../../state/settingsHooks';

/**
 * Protection management: enable/disable the login requirement, change the
 * password and register named API tokens.
 */
export function Security() {
    const { t } = useTranslation();
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
            setError(t('auth.passwordMismatch'));
            return;
        }
        if (password.length < 8) {
            setError(t('security.passwordMin'));
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
            setInfo(t('security.protectionEnabledInfo'));
        } catch (e) {
            setError(e?.message ?? t('security.enableFailed'));
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
            setInfo(t('security.passwordUpdated'));
        } catch (e) {
            setError(e?.message ?? t('security.passwordUpdateFailed'));
        } finally {
            setBusy(false);
        }
    };

    const createToken = async () => {
        setError(null);
        setInfo(null);
        const name = tokenName.trim();
        if (!name) {
            setError(t('security.tokenNameRequired'));
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
            setError(e?.message ?? t('security.tokenCreateFailed'));
        } finally {
            setBusy(false);
        }
    };

    const revoke = async (id) => {
        if (!window.confirm(t('security.revokeConfirm'))) {
            return;
        }
        try {
            await apiStrict(`auth/tokens/${id}`, { method: 'DELETE' });
            await loadTokens();
        } catch (e) {
            setError(e?.message ?? t('security.tokenRevokeFailed'));
        }
    };

    const copyToken = async () => {
        try {
            await navigator.clipboard.writeText(createdToken);
            setInfo(t('security.tokenCopied'));
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
            setInfo(t('security.protectionEnabledSignIn'));
        } catch (e) {
            setError(e?.message ?? t('security.enableFailed'));
        } finally {
            setBusy(false);
        }
    };

    const disableProtection = async () => {
        if (!window.confirm(t('security.disableConfirm'))) {
            return;
        }
        setError(null);
        setInfo(null);
        setBusy(true);
        try {
            await setProtection(false);
            setInfo(t('security.protectionDisabled'));
        } catch (e) {
            setError(e?.message ?? t('security.disableFailed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}>
            <Box>
                <Typography variant="h6">{t('security.title')}</Typography>
                <Typography variant="body2" color="text.secondary">
                    {t('security.subtitle')}
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
                        {t('security.openApiWarning')}
                    </Alert>
                    <TextField
                        label={t('auth.username')}
                        size="small"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        autoComplete="username"
                    />
                    <TextField
                        label={t('auth.password')}
                        size="small"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        helperText={t('auth.atLeast8')}
                    />
                    <TextField
                        label={t('auth.confirmPassword')}
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
                            {t('security.createAndEnable')}
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
                        {t('security.accountExistsWarning')}
                    </Alert>
                    <Box>
                        <Button
                            variant="contained"
                            disabled={busy}
                            onClick={enableExistingAccount}
                        >
                            {t('security.enable')}
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
                            label={t('security.enabledChip')}
                            size="small"
                        />
                        {authState.user && (
                            <Typography variant="body2">
                                {t('security.signedInAs', {
                                    user: authState.user,
                                })}
                            </Typography>
                        )}
                        <Button
                            size="small"
                            color="warning"
                            disabled={busy}
                            onClick={disableProtection}
                        >
                            {t('security.disable')}
                        </Button>
                    </Box>

                    <Divider />
                    <Typography variant="subtitle1">
                        {t('security.changePassword')}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <TextField
                            label={t('security.currentPassword')}
                            size="small"
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            autoComplete="current-password"
                        />
                        <TextField
                            label={t('security.newPassword')}
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
                            {t('common.update')}
                        </Button>
                    </Box>

                    <Divider />
                    <Typography variant="subtitle1">
                        {t('security.apiTokens')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {t('security.apiTokensHint')}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <TextField
                            label={t('security.appName')}
                            size="small"
                            value={tokenName}
                            onChange={(e) => setTokenName(e.target.value)}
                        />
                        <Button
                            variant="contained"
                            disabled={busy || !tokenName.trim()}
                            onClick={createToken}
                        >
                            {t('security.createToken')}
                        </Button>
                    </Box>

                    {createdToken && (
                        <Alert
                            severity="warning"
                            onClose={() => setCreatedToken(null)}
                        >
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                {t('security.copyTokenNow')}
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
                                    aria-label={t('security.copyToken')}
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
                                        aria-label={t('security.revokeToken')}
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
                                            ? t('security.browserSession')
                                            : t('security.apiToken')
                                    } · ${t('security.created', {
                                        date: new Date(
                                            token.createdAt
                                        ).toLocaleString(),
                                    })}${
                                        token.lastUsedAt
                                            ? ` · ${t('security.lastUsed', {
                                                  date: new Date(
                                                      token.lastUsedAt
                                                  ).toLocaleString(),
                                              })}`
                                            : ` · ${t('security.neverUsed')}`
                                    }`}
                                />
                            </ListItem>
                        ))}
                        {!tokens.length && (
                            <ListItem>
                                <ListItemText primary={t('security.noTokens')} />
                            </ListItem>
                        )}
                    </List>

                </Box>
            )}
        </Box>
    );
}

