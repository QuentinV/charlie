import React, { useCallback, useEffect, useState } from 'react';
import {
    Box,
    Typography,
    Paper,
    Switch,
    IconButton,
    TextField,
    Button,
    Alert,
    CircularProgress,
    Tooltip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Chip,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../../api/charlie';
import AutomationGraph from './AutomationGraph';
import { draftSteps } from './draft';
import { filterGraph } from './layout';
import { useTranslation } from 'react-i18next';

/**
 * Automations tab: a compact list (the interactive controls the graph
 * deliberately does not carry) over one read-only graph of everything.
 */
export const AutomationsList = () => {
    const { t } = useTranslation();
    const [automations, setAutomations] = useState(/** @type {any[]} */ ([]));
    const [graph, setGraph] = useState(/** @type {any} */ (null));
    /** The selected card: it filters the graph down to one automation. */
    const [selected, setSelected] = useState(/** @type {string|null} */ (null));
    const [running, setRunning] = useState(null);
    const [toDelete, setToDelete] = useState(/** @type {any} */ (null));
    /** Only needed to name the devices a draft's nodes refer to by id. */
    const [devices, setDevices] = useState(/** @type {any[]} */ ([]));

    const load = useCallback(async () => {
        // The declared automations (the cards) and the observed house graph
        // (the picture) are two different reads of the same system.
        const [list, house, devs] = await Promise.all([
            api('automations'),
            api('automations/graph'),
            api('devices'),
        ]);
        setAutomations(Array.isArray(list) ? list : []);
        setGraph(house?.nodes ? house : { nodes: [], edges: [] });
        setDevices(Array.isArray(devs) ? devs : []);
    }, []);

    const visibleGraph = React.useMemo(
        () => filterGraph(graph, selected),
        [graph, selected]
    );

    /** `deviceId → name`, because a node only carries the id. */
    const deviceName = React.useMemo(
        () =>
            new Map(
                (devices ?? []).map((device) => [
                    String(device?._id),
                    device?.name,
                ])
            ),
        [devices]
    );

    useEffect(() => {
        load();
    }, [load]);

    const runNow = useCallback(async (automation) => {
        setRunning(automation._id);
        try {
            await api(`automations/${automation._id}/run`, { method: 'POST' });
        } finally {
            setRunning(null);
        }
    }, []);

    const toggle = useCallback(async (automation) => {
        const res = await api(`automations/${automation._id}/toggle`, {
            method: 'POST',
        });
        setAutomations((prev) =>
            prev.map((a) =>
                a._id === automation._id ? { ...a, active: res?.active } : a
            )
        );
    }, []);

    // Deleting is the real removal; the switch only parks an automation.
    const remove = useCallback(async () => {
        if (!toDelete) return;
        await api(`automations/${toDelete._id}`, { method: 'DELETE' });
        setToDelete(null);
        await load();
    }, [toDelete, load]);

    // --- Natural-language compose (P3) ---
    const [text, setText] = useState('');
    const [draft, setDraft] = useState(null);
    const [warnings, setWarnings] = useState([]);
    const [composing, setComposing] = useState(false);
    const [composeError, setComposeError] = useState('');

    const compose = useCallback(async () => {
        if (!text.trim()) return;
        setComposing(true);
        setComposeError('');
        setWarnings([]);
        try {
            const res = await api('automations/compose', {
                method: 'POST',
                body: JSON.stringify({ text }),
            });
            if (res?.error) {
                setComposeError(res.error);
                setDraft(null);
            } else {
                setDraft(res?.automation ?? null);
                setWarnings(res?.warnings ?? []);
            }
        } catch (e) {
            setComposeError(String(e?.message ?? e));
        } finally {
            setComposing(false);
        }
    }, [text]);

    const discardDraft = useCallback(() => {
        setDraft(null);
        setWarnings([]);
    }, []);

    const saveDraft = useCallback(async () => {
        if (!draft) return;
        await api('automations', {
            method: 'POST',
            body: JSON.stringify(draft),
        });
        setDraft(null);
        setText('');
        setWarnings([]);
        await load();
    }, [draft, load]);

    /** What the model understood, in reading order. */
    const steps = React.useMemo(
        () =>
            draftSteps(
                draft?.nodes,
                (id) => deviceName.get(String(id)) ?? String(id ?? ''),
                t
            ),
        [draft, deviceName, t]
    );

    return (
        <Box
            height="100%"
            display="flex"
            flexDirection="column"
            overflow="hidden"
        >
            <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                mb={2}
            >
                <Typography variant="h4" fontWeight={700}>
                    {t('nav.automations')}
                </Typography>
                <Box
                    sx={{
                        px: 1.5,
                        py: 0.5,
                        borderRadius: 99,
                        bgcolor: 'rgba(255, 215, 0, 0.12)',
                        color: 'primary.main',
                        fontWeight: 700,
                        fontSize: '0.8125rem',
                    }}
                >
                    {t('automations.activesCount', {
                        n: automations.filter((a) => a.active).length,
                    })}
                </Box>
            </Box>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 4, mb: 2 }}>
                <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    size="small"
                    placeholder={t('automations.composePlaceholder')}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    disabled={composing}
                />
                <Box display="flex" justifyContent="flex-end" mt={1}>
                    <Button
                        variant="contained"
                        startIcon={
                            composing ? (
                                <CircularProgress size={16} color="inherit" />
                            ) : (
                                <AutoAwesomeIcon />
                            )
                        }
                        disabled={composing || !text.trim()}
                        onClick={compose}
                    >
                        {t('automations.compose')}
                    </Button>
                </Box>
                {composeError && (
                    <Alert severity="error" sx={{ mt: 1 }}>
                        {composeError}
                    </Alert>
                )}
                {warnings.map((warning, i) => (
                    <Alert key={i} severity="warning" sx={{ mt: 1 }}>
                        {warning}
                    </Alert>
                ))}
            </Paper>

            {draft && (
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 4, mb: 2 }}>
                    <Typography variant="subtitle1" fontWeight={700} mb={1}>
                        {draft.name}
                    </Typography>
                    {steps.length > 0 && (
                        <Box mb={1}>
                            <Typography
                                variant="caption"
                                sx={{ color: 'text.secondary' }}
                            >
                                {t('automations.draftSteps')}
                            </Typography>
                            {steps.map((step) => (
                                <Typography
                                    key={step.id}
                                    variant="body2"
                                    sx={{ color: 'text.secondary' }}
                                >
                                    <Box
                                        component="span"
                                        sx={{
                                            color: 'primary.main',
                                            fontWeight: 600,
                                        }}
                                    >
                                        {step.kind}
                                    </Box>
                                    {` · ${step.detail}`}
                                </Typography>
                            ))}
                        </Box>
                    )}
                    <Box display="flex" justifyContent="flex-end" gap={1} mt={1}>
                        <Button onClick={discardDraft}>
                            {t('automations.composeCancel')}
                        </Button>
                        <Button variant="contained" onClick={saveDraft}>
                            {t('automations.composeSave')}
                        </Button>
                    </Box>
                </Paper>
            )}

            <Box overflow="auto" flexGrow={1} minHeight={0}>
                {automations.length === 0 ? (
                    <Paper
                        variant="outlined"
                        sx={{
                            p: 4,
                            textAlign: 'center',
                            borderRadius: 4,
                            borderStyle: 'dashed',
                        }}
                    >
                        <Typography sx={{ color: 'text.secondary' }}>
                            {t('automations.empty')}
                        </Typography>
                    </Paper>
                ) : (
                    <>
                        <AutomationGraph graph={visibleGraph} />

                        {selected && (
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    mt: 1.5,
                                    mb: 1,
                                }}
                            >
                                <Chip
                                    size="small"
                                    label={t('automations.showing', {
                                        name:
                                            automations.find(
                                                (a) => a._id === selected
                                            )?.name ?? '',
                                    })}
                                    onDelete={() => setSelected(null)}
                                />
                            </Box>
                        )}

                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns:
                                    'repeat(auto-fill, minmax(220px, 1fr))',
                                gap: 1,
                                // The filter chip already spaces itself when it
                                // is shown; otherwise the cards need a gap from
                                // the canvas.
                                mt: selected ? 0 : 1.5,
                            }}
                        >
                            {automations.map((automation) => {
                                const nodes = automation.nodes ?? [];
                                const triggers = nodes.filter(
                                    (n) => n.kind === 'trigger'
                                ).length;
                                const actions = nodes.filter(
                                    (n) =>
                                        n.kind === 'action' ||
                                        n.kind === 'notify'
                                ).length;
                                const isSelected =
                                    selected === automation._id;

                                return (
                                    <Paper
                                        key={automation._id}
                                        elevation={0}
                                        onClick={() =>
                                            setSelected(
                                                isSelected
                                                    ? null
                                                    : automation._id
                                            )
                                        }
                                        sx={{
                                            p: 1.25,
                                            borderRadius: 3,
                                            cursor: 'pointer',
                                            border: '1px solid',
                                            borderColor: isSelected
                                                ? 'primary.main'
                                                : automation.active
                                                ? 'primary.200'
                                                : 'grey.200',
                                            bgcolor: isSelected
                                                ? 'primary.50'
                                                : 'transparent',
                                        }}
                                    >
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                            }}
                                        >
                                            <Typography
                                                sx={{
                                                    flex: 1,
                                                    fontWeight: 700,
                                                    color: automation.active
                                                        ? 'text.primary'
                                                        : 'text.disabled',
                                                }}
                                            >
                                                {automation.name}
                                            </Typography>
                                            <Box
                                                sx={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 1,
                                                }}
                                                onClick={(e) =>
                                                    e.stopPropagation()
                                                }
                                            >
                                                <IconButton
                                                    size="small"
                                                    disabled={
                                                        running ===
                                                        automation._id
                                                    }
                                                    onClick={() =>
                                                        runNow(automation)
                                                    }
                                                    sx={{
                                                        bgcolor: 'primary.50',
                                                        color: 'primary.main',
                                                    }}
                                                >
                                                    <PlayArrowIcon fontSize="small" />
                                                </IconButton>
                                                <Switch
                                                    checked={
                                                        !!automation.active
                                                    }
                                                    onChange={() =>
                                                        toggle(automation)
                                                    }
                                                    color="primary"
                                                />
                                                <Tooltip
                                                    title={t('common.delete')}
                                                >
                                                    <IconButton
                                                        size="small"
                                                        color="error"
                                                        onClick={() =>
                                                            setToDelete(
                                                                automation
                                                            )
                                                        }
                                                    >
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            </Box>
                                        </Box>
                                        <Typography
                                            variant="caption"
                                            sx={{ color: 'text.secondary' }}
                                        >
                                                {`${triggers} × ${t(
                                                    'automations.kind.trigger'
                                                )} · ${actions} × ${t(
                                                    'automations.kind.action'
                                                )}`}
                                                {automation.lastRun
                                                    ? ` · ${new Date(
                                                          automation.lastRun
                                                      ).toLocaleString()}`
                                                    : ''}
                                        </Typography>
                                    </Paper>
                                );
                            })}
                        </Box>

                    </>
                )}
            </Box>

            <Dialog open={!!toDelete} onClose={() => setToDelete(null)}>
                <DialogTitle>{t('automations.deleteTitle')}</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {t('automations.deleteWarning', {
                            name: toDelete?.name ?? '',
                        })}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setToDelete(null)}>
                        {t('common.cancel')}
                    </Button>
                    <Button color="error" onClick={remove} autoFocus>
                        {t('common.delete')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
