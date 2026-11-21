import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Alert,
    Box,
    CircularProgress,
    Grid,
    List,
    Paper,
    Snackbar,
    Stack,
    Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/charlie';
import { DocumentCard } from './DocumentCard';
import { DocumentView } from './DocumentView';
import { ScanDrop } from './ScanDrop';
import { TypePicker } from './TypePicker';

/** Polling cadence while a document is being read (a CPU read takes minutes). */
const POLL_MS = 5000;

/** How many scans the history shows (the server rotates the images). */
const HISTORY = 30;

/**
 * Scan tab: photograph a document and see what Charlie read in it.
 *
 * The reading happens **on the server, in the background** (a vision call takes
 * tens of seconds to minutes on CPU, far beyond a proxy timeout): the upload
 * answers with a `pending` record and this page polls it until it turns `done`
 * or `failed`. A failed scan keeps its image, so *réessayer* — or a corrected
 * type — re-reads the same photo, reusing the classifier's answer when there is
 * one.
 */
export const Vision = () => {
    const { t, i18n } = useTranslation();
    const lang = (i18n?.language ?? 'fr').slice(0, 2);

    const [status, setStatus] = useState(null);
    const [scans, setScans] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    /** Type forced for the next upload ('' = let the model classify). */
    const [type, setType] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);
    /**
     * Library record of the selected recipe scan, when the household kept it:
     * the detail view then links to the recipe instead of offering to file it.
     */
    const [savedRecipe, setSavedRecipe] = useState(null);
    /** Bumped after an action, so that link is read again. */
    const [savedVersion, setSavedVersion] = useState(0);
    const pollRef = useRef(null);

    const load = useCallback(async (silent = false) => {
        const res = await api(`vision/scans?limit=${HISTORY}`);
        if (res?.scans) setScans(res.scans);
        if (!silent) setLoading(false);
        return res?.scans ?? [];
    }, []);

    useEffect(() => {
        (async () => {
            const info = await api('vision');
            if (info) setStatus(info);
            const list = await load();
            setSelectedId((current) => current ?? list[0]?.id ?? null);
        })();
    }, [load]);

    // One reading in flight is enough reason to poll the history.
    const pending = scans.some((scan) => scan.status === 'pending');
    useEffect(() => {
        if (!pending) return undefined;
        pollRef.current = setInterval(() => {
            void load(true);
        }, POLL_MS);
        return () => clearInterval(pollRef.current);
    }, [pending, load]);

    const selected = scans.find((scan) => scan.id === selectedId) ?? null;
    const selectedType = selected?.type;
    const selectedStatus = selected?.status;

    // A recipe scan already filed in the household library links to its recipe;
    // the library stays the source of truth, so deleting the recipe removes the
    // link on its own.
    useEffect(() => {
        if (
            !selectedId ||
            selectedType !== 'recipe' ||
            selectedStatus !== 'done'
        ) {
            setSavedRecipe(null);
            return undefined;
        }

        let cancelled = false;
        api(`recipes?scanId=${selectedId}`).then((res) => {
            if (!cancelled) setSavedRecipe(res?.recipes?.[0] ?? null);
        });
        return () => {
            cancelled = true;
        };
    }, [selectedId, selectedType, selectedStatus, savedVersion]);

    /** Put a fresh scan at the top of the history and select it. */
    const upsert = useCallback((scan) => {
        setScans((current) => [
            scan,
            ...current.filter((s) => s.id !== scan.id),
        ]);
        setSelectedId(scan.id);
    }, []);

    const run = useCallback(async (action) => {
        setBusy(true);
        try {
            await action();
        } finally {
            setBusy(false);
        }
    }, []);

    const rescan = (nextType) =>
        run(async () => {
            if (!selected) return;
            const res = await api(`vision/scans/${selected.id}/rescan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(nextType ? { type: nextType } : {}),
            });
            if (res?.scan) {
                upsert(res.scan);
            } else {
                setNotice({
                    severity: 'error',
                    message: res?.message ?? t('vision.failedGeneric'),
                });
            }
        });

    const act = (actionId) =>
        run(async () => {
            if (!selected) return;
            const res = await api(
                `vision/scans/${selected.id}/actions/${actionId}`,
                { method: 'POST' }
            );
            setNotice(
                res?.ok
                    ? { severity: 'success', message: res.message }
                    : {
                          severity: 'error',
                          message: res?.error ?? t('vision.actionFailed'),
                      }
            );
            // Filing a recipe turns the button into a link to it: re-read it.
            if (res?.ok) setSavedVersion((version) => version + 1);
        });

    const remove = () =>
        run(async () => {
            if (!selected) return;
            await api(`vision/scans/${selected.id}`, { method: 'DELETE' });
            setSelectedId(null);
            await load();
        });

    if (loading) {
        return (
            <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Typography variant="h5" gutterBottom>
                {t('vision.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('vision.subtitle')}
            </Typography>

            {status && status.enabled === false && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    {t('vision.disabled')}
                </Alert>
            )}

            <Grid container spacing={2}>
                <Grid item xs={12} md={5}>
                    <Stack spacing={2}>
                        <ScanDrop
                            type={type}
                            disabled={status?.enabled === false}
                            onScan={upsert}
                            onError={(message) =>
                                setNotice({
                                    severity: 'error',
                                    message:
                                        message ?? t('vision.uploadFailed'),
                                })
                            }
                        />

                        <Paper variant="outlined" sx={{ p: 1.5 }}>
                            <Typography variant="subtitle2" gutterBottom>
                                {t('vision.typeTitle')}
                            </Typography>
                            <TypePicker
                                modules={status?.modules}
                                value={type}
                                onChange={setType}
                            />
                        </Paper>

                        {!!scans.length && (
                            <Paper variant="outlined" sx={{ p: 1 }}>
                                <List dense sx={{ p: 0 }}>
                                    {scans.map((scan) => (
                                        <DocumentCard
                                            key={scan.id}
                                            scan={scan}
                                            modules={status?.modules}
                                            lang={lang}
                                            selected={scan.id === selectedId}
                                            onSelect={(s) => setSelectedId(s.id)}
                                        />
                                    ))}
                                </List>
                            </Paper>
                        )}
                    </Stack>
                </Grid>

                <Grid item xs={12} md={7}>
                    {selected ? (
                        <Paper variant="outlined" sx={{ p: 2 }}>
                            <DocumentView
                                scan={selected}
                                savedRecipe={savedRecipe}
                                modules={status?.modules}
                                lang={lang}
                                busy={busy}
                                onRescan={rescan}
                                onAction={act}
                                onDelete={remove}
                            />
                        </Paper>
                    ) : (
                        <Paper
                            variant="outlined"
                            sx={{ p: 4, textAlign: 'center' }}
                        >
                            <Typography color="text.secondary">
                                {t('vision.empty')}
                            </Typography>
                        </Paper>
                    )}
                </Grid>
            </Grid>

            <Snackbar
                open={!!notice}
                autoHideDuration={6000}
                onClose={() => setNotice(null)}
            >
                <Alert
                    severity={notice?.severity ?? 'info'}
                    onClose={() => setNotice(null)}
                >
                    {notice?.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default Vision;

