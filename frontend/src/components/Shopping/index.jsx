import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Paper,
    Snackbar,
    Stack,
    Typography,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/charlie';
import { AddBar } from './AddBar';
import { PendingCard } from './PendingCard';
import { ItemList } from './ItemList';
import { ItemDialog } from './ItemDialog';
import { Bucket } from './Bucket';
import { FinishBar } from './FinishBar';
import { History } from './History';
import { isStructuring } from './utils';

/** Polling cadence while the background restructuring is in flight. */
const POLL_MS = 2500;

/**
 * Shopping tab.
 *
 * The list is fed with raw requests (voice through the AI page, text here) that
 * a small model structures in the background; this page only reads the result
 * and drives the checkbox: `todo` → basket, with a cancel that puts the line
 * back. "Terminer" archives the basket and keeps the rest for next time.
 */
export const Shopping = () => {
    const { t } = useTranslation();
    const [list, setList] = useState(null);
    const [enabled, setEnabled] = useState(true);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [edited, setEdited] = useState(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    /** Last line moved to the basket: offers an immediate undo. */
    const [undo, setUndo] = useState(null);
    const pollRef = useRef(null);

    const apply = useCallback((res) => {
        if (!res?.list) return;
        setList(res.list);
        if (res.enabled !== undefined) setEnabled(res.enabled);
    }, []);

    const load = useCallback(
        async (silent = false) => {
            const res = await api('shopping');
            if (res) apply(res);
            if (!silent) setLoading(false);
        },
        [apply]
    );

    /**
     * Every mutation returns the fresh list, so the UI never guesses. Returns
     * `undefined` on failure, so a caller can tell whether it succeeded.
     */
    const run = useCallback(
        async (action) => {
            setBusy(true);
            setError('');
            try {
                const res = await action();
                if (res?.error) {
                    setError(res.error);
                    return undefined;
                }
                apply(res);
                return res;
            } catch (e) {
                setError(e?.message ?? String(e));
                return undefined;
            } finally {
                setBusy(false);
            }
        },
        [apply]
    );

    const setStatus = useCallback(
        (item, status) =>
            run(() =>
                api(`shopping/items/${item.id}/status`, {
                    method: 'POST',
                    body: JSON.stringify({ status }),
                })
            ),
        [run]
    );

    const removeItem = useCallback(
        (item) =>
            run(() =>
                api(`shopping/items/${item.id}`, { method: 'DELETE' })
            ),
        [run]
    );

    /** Checking a line is the main gesture: confirm it and offer an undo. */
    const takeItem = useCallback(
        async (item) => {
            const res = await setStatus(item, 'taken');
            if (res) {
                setUndo({
                    id: item.id,
                    name: item.name,
                    message: t('shopping.movedToBasket', { name: item.name }),
                });
            }
        },
        [setStatus, t]
    );

    const undoTake = useCallback(async () => {
        const item = undo;
        setUndo(null);
        if (item) await setStatus(item, 'todo');
    }, [undo, setStatus]);

    useEffect(() => {
        load();
    }, [load]);

    // While the restructurer works, the items appear a few seconds later.
    useEffect(() => {
        clearInterval(pollRef.current);
        if (list && isStructuring(list)) {
            pollRef.current = setInterval(() => load(true), POLL_MS);
        }
        return () => clearInterval(pollRef.current);
    }, [list, load]);

    const items = list?.items ?? [];
    const todo = items.filter((i) => i.status === 'todo');
    const taken = items.filter((i) => i.status === 'taken');

    return (
        <Box>
            <Paper sx={{ p: 2 }}>
                <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    mb={2}
                    flexWrap="wrap"
                >
                    <Typography variant="h5" fontWeight={700}>
                        {t('nav.shopping')}
                    </Typography>
                    <Chip
                        size="small"
                        color="primary"
                        variant="outlined"
                        label={t('shopping.counts', {
                            todo: list?.todo ?? 0,
                            taken: list?.taken ?? 0,
                        })}
                    />
                    <Button
                        size="small"
                        startIcon={<HistoryIcon />}
                        sx={{ ml: 'auto' }}
                        onClick={() => setHistoryOpen(true)}
                    >
                        {t('shopping.history')}
                    </Button>
                </Stack>

                {!enabled && (
                    <Alert severity="info" sx={{ mb: 2 }}>
                        {t('shopping.disabled')}
                    </Alert>
                )}

                <AddBar
                    disabled={!enabled || busy}
                    onAdd={(text) =>
                        run(() =>
                            api('shopping/requests', {
                                method: 'POST',
                                body: JSON.stringify({ texts: [text] }),
                            })
                        )
                    }
                />

                <Box sx={{ mt: 2 }}>
                    <PendingCard
                        list={list}
                        busy={busy}
                        onRetry={() =>
                            run(() =>
                                api('shopping/restructure', { method: 'POST' })
                            )
                        }
                        onApply={() =>
                            run(() =>
                                api('shopping/requests/apply', {
                                    method: 'POST',
                                })
                            )
                        }
                    />
                </Box>

                {error && (
                    <Alert
                        severity="error"
                        sx={{ mt: 2 }}
                        onClose={() => setError('')}
                    >
                        {error}
                    </Alert>
                )}

                <Box sx={{ mt: 2 }}>
                    {loading && !list ? (
                        <CircularProgress size={22} />
                    ) : (
                        <ItemList
                            items={todo}
                            busy={busy}
                            onEdit={setEdited}
                            onRemove={removeItem}
                            onTake={takeItem}
                        />
                    )}
                </Box>

                <Bucket
                    items={taken}
                    busy={busy}
                    onUntake={(item) => setStatus(item, 'todo')}
                    onRemove={removeItem}
                />

                <FinishBar
                    list={list}
                    busy={busy}
                    onFinish={() =>
                        run(() => api('shopping/finish', { method: 'POST' }))
                    }
                    onUncheckAll={() =>
                        run(() => api('shopping/uncheck-all', { method: 'POST' }))
                    }
                    onClear={() =>
                        run(() => api('shopping/clear', { method: 'POST' }))
                    }
                />
            </Paper>

            <ItemDialog
                item={edited}
                open={!!edited}
                busy={busy}
                onClose={() => setEdited(null)}
                onSave={(id, patch) =>
                    run(() =>
                        api(`shopping/items/${id}`, {
                            method: 'PUT',
                            body: JSON.stringify(patch),
                        })
                    )
                }
            />

            <History open={historyOpen} onClose={() => setHistoryOpen(false)} />

            {/* Checking a line is the one gesture done while walking: confirm it
                right there, with the undo within thumb reach. */}
            <Snackbar
                open={!!undo}
                autoHideDuration={6000}
                onClose={() => setUndo(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                sx={{ mb: { xs: 9, sm: 0 } }}
            >
                <Alert
                    severity="success"
                    variant="filled"
                    onClose={() => setUndo(null)}
                    action={
                        <Button
                            color="inherit"
                            size="small"
                            disabled={busy}
                            onClick={undoTake}
                        >
                            {t('shopping.undo')}
                        </Button>
                    }
                >
                    {undo?.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default Shopping;
