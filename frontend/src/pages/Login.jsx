import React from 'react';
import {
    Alert,
    Box,
    Button,
    Paper,
    TextField,
    Typography,
} from '@mui/material';
import { useUnit } from 'effector-react';
import { auth } from '../state/auth';

/**
 * Sign-in screen (also used for the one-time administrator setup when
 * protection was enabled without an account).
 */
export function LoginPage({ setupRequired }) {
    const login = useUnit(auth.loginFx);
    const setup = useUnit(auth.setupFx);

    const [username, setUsername] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [confirm, setConfirm] = React.useState('');
    const [error, setError] = React.useState(null);
    const [busy, setBusy] = React.useState(false);

    const submit = async (event) => {
        event.preventDefault();
        setError(null);

        if (setupRequired && password !== confirm) {
            setError('Passwords do not match.');
            return;
        }

        setBusy(true);
        try {
            if (setupRequired) await setup({ username, password });
            else await login({ username, password });
        } catch (e) {
            setError(e?.message ?? 'Unable to sign in.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                p: 2,
            }}
        >
            <Paper
                component="form"
                onSubmit={submit}
                sx={{ p: 3, width: '100%', maxWidth: 420 }}
            >
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <img
                            src="/dark_icon_short.png"
                            width="40"
                            height="40"
                            style={{ borderRadius: 12 }}
                        />
                        <Box>
                            <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                Charlie
                            </Typography>
                            <Typography
                                variant="caption"
                                sx={{ color: 'text.secondary' }}
                            >
                                {setupRequired
                                    ? 'Create the administrator account'
                                    : 'Sign in to continue'}
                            </Typography>
                        </Box>
                    </Box>

                    <TextField
                        label="Username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        autoComplete="username"
                        autoFocus
                        fullWidth
                    />
                    <TextField
                        label="Password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete={
                            setupRequired ? 'new-password' : 'current-password'
                        }
                        fullWidth
                    />
                    {setupRequired && (
                        <TextField
                            label="Confirm password"
                            type="password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            autoComplete="new-password"
                            helperText="At least 8 characters."
                            fullWidth
                        />
                    )}

                    {error && <Alert severity="error">{error}</Alert>}

                    <Button
                        type="submit"
                        variant="contained"
                        disabled={busy || !username || !password}
                    >
                        {setupRequired ? 'Create account' : 'Sign in'}
                    </Button>
                </Box>
            </Paper>
        </Box>
    );
}
