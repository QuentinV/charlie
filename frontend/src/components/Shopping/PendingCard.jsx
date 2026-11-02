import React from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    LinearProgress,
    Paper,
    Stack,
    Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * Shows the *temporary* list: the raw requests that are waiting for (or being
 * handled by) the background restructurer, plus its outcome when it failed.
 * Nothing is ever dropped: a failed run can be retried, or applied verbatim by
 * the deterministic parser.
 */
export const PendingCard = ({ list, onRetry, onApply, busy }) => {
    const { t } = useTranslation();
    const pending = list?.pending ?? [];
    const state = list?.processing?.state ?? 'idle';

    if (!pending.length && state !== 'failed') return null;

    return (
        <Paper
            variant="outlined"
            sx={{ p: 1.5, borderRadius: 3, borderStyle: 'dashed' }}
        >
            <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                <Typography variant="subtitle2">
                    {t('shopping.pendingTitle')}
                </Typography>
                {state === 'running' && (
                    <Chip
                        size="small"
                        color="primary"
                        label={t('shopping.structuring')}
                    />
                )}
            </Stack>

            {state === 'running' && <LinearProgress sx={{ mb: 1 }} />}

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                {pending.map((r) => (
                    <Chip
                        key={r.id}
                        size="small"
                        variant="outlined"
                        label={r.text}
                    />
                ))}
            </Box>

            {state === 'failed' && (
                <Alert
                    severity="warning"
                    sx={{ mb: 1, borderRadius: 2 }}
                    action={
                        <Stack direction="row" spacing={1}>
                            <Button
                                color="inherit"
                                size="small"
                                disabled={busy}
                                onClick={onApply}
                            >
                                {t('shopping.applyVerbatim')}
                            </Button>
                            <Button
                                color="inherit"
                                size="small"
                                variant="outlined"
                                disabled={busy}
                                onClick={onRetry}
                            >
                                {t('common.retry')}
                            </Button>
                        </Stack>
                    }
                >
                    {list?.processing?.error
                        ? t('shopping.failed', {
                              error: list.processing.error,
                          })
                        : t('shopping.failedGeneric')}
                </Alert>
            )}

            {state !== 'failed' && (
                <Typography variant="caption" color="text.secondary">
                    {t('shopping.pendingHint')}
                </Typography>
            )}
        </Paper>
    );
};

export default PendingCard;
