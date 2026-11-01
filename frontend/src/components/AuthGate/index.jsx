import React from 'react';
import { Box, CircularProgress } from '@mui/material';
import { useUnit } from 'effector-react';
import { useTranslation } from 'react-i18next';
import { auth } from '../../state/auth';
import { LoginPage } from '../../pages/Login';

/**
 * Renders the login screen while protection is enabled and no valid token is
 * stored; otherwise renders the app shell.
 */
export function AuthGate({ children }) {
    const { t } = useTranslation();
    const state = useUnit(auth.$auth);

    if (state.loading) {
        return (
            <Box
                sx={{
                    height: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <CircularProgress
                    aria-label={t('common.loading')}
                    size={48}
                    thickness={4}
                />
            </Box>
        );
    }

    if (state.enabled && !state.authenticated) {
        return <LoginPage setupRequired={state.setupRequired} />;
    }

    return children;
}
