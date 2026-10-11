import React, { useEffect, useRef, useState } from 'react';
import {
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    TextField,
    Typography,
    Alert,
    Snackbar,
    Stack,
} from '@mui/material';
import { api } from '../../api/charlie';

// =====================================================================
// Home Assistant integration manager (generic config-flow wizard).
// Renders HA's config-flow data_schema into a native MUI form so users
// can add / remove device integrations WITHOUT ever opening the HA UI.
// =====================================================================

/** Friendly labels for well-known integration handlers (fallback = raw). */
const HANDLER_LABELS = {
    shelly: 'Shelly',
    tuya: 'Tuya',
    localtuya: 'LocalTuya',
    tradfri: 'IKEA Trådfri',
    meross: 'Meross',
    nanoleaf: 'Nanoleaf',
    sony: 'Sony Bravia',
    samsungtv: 'Samsung TV',
    mitsubishi: 'Mitsubishi',
    mqtt: 'MQTT',
    zha: 'Zigbee (ZHA)',
    zwave_js: 'Z-Wave',
    esphome: 'ESPHome',
    homekit_controller: 'HomeKit',
    thread: 'Thread',
    meross_lan: 'Meross LAN (community)',
};

function handlerLabel(handler) {
    return HANDLER_LABELS[handler?.toLowerCase()] || handler;
}

/** Turn a raw step id (`meross_cloud`) into a display label (`Meross Cloud`). */
function prettifyStepId(id) {
    return String(id ?? '')
        .split(/[_-]/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

/**
 * Normalize HA schema "options" into [{ value, label }]. HA may serialize a
 * select's options as an object ({value: label}), as [{value,label}], or as a
 * plain string[] (e.g. the menu step's inferred `next_step_id` field).
 */
/**
 * HA sometimes serializes a field's description/default as an object (e.g.
 * `{ suggested_value: … }`). Never render those as React children — coerce
 * everything to a display string.
 */
function asText(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') {
        return String(value);
    }
    if (typeof value === 'object' && 'suggested_value' in value) {
        return asText(value.suggested_value);
    }
    return '';
}

function normalizeOptions(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw.map((o) =>
            o && typeof o === 'object'
                ? {
                      value: o.value ?? o.label,
                      label: asText(o.label ?? o.value),
                  }
                : { value: o, label: asText(o) }
        );
    }
    return Object.entries(raw).map(([k, v]) => ({
        value: k,
        label: asText(v) || k,
    }));
}

/**
 * Choices of an HA `menu` step. HA returns `menu_options` (a list/dict of step
 * ids) plus an inferred `next_step_id` data_schema field; we accept any shape.
 */
function menuChoices(step) {
    const raw = step?.menu_options;
    if (Array.isArray(raw)) {
        return raw.map((o) =>
            o && typeof o === 'object'
                ? {
                      value: o.value,
                      label: asText(o.label) || prettifyStepId(o.value),
                  }
                : { value: o, label: prettifyStepId(o) }
        );
    }
    if (raw && typeof raw === 'object') {
        return Object.entries(raw).map(([k, v]) => ({
            value: k,
            label: typeof v === 'string' ? v : prettifyStepId(k),
        }));
    }
    const field = (step?.data_schema ?? []).find(
        (f) => f.name === 'next_step_id'
    );
    return normalizeOptions(field?.options).map((o) => ({
        value: o.value,
        label: o.label ?? prettifyStepId(o.value),
    }));
}

/** Coerce a value to the type HA expects for a schema field. */
function coerceValue(value, type) {
    if (value === '' || value === undefined || value === null) return undefined;
    if (type === 'integer') return parseInt(value, 10);
    if (type === 'float') return parseFloat(value);
    if (type === 'boolean') return value === true || value === 'true';
    if (type === 'string' && typeof value === 'string') return value;
    return value;
}

/** Pull a human-readable HA error message out of an api() failure. */
function haErrorMessage(e) {
    // e may be a string (plain-text body), an Error, or {message, errors}.
    if (typeof e === 'string') return e;
    if (e?.errors && typeof e.errors === 'object') {
        const base = e.errors?.base;
        if (Array.isArray(base)) return base[0] || 'Validation error';
        if (typeof base === 'string') return base;
        const first = Object.entries(e.errors).find(
            ([, v]) => typeof v === 'string' || Array.isArray(v)
        );
        if (first) {
            const val = first[1];
            return Array.isArray(val)
                ? `${first[0]}: ${val[0]}`
                : `${first[0]}: ${val}`;
        }
    }
    if (typeof e?.message === 'string') return e.message;
    if (e?.detail) {
        try {
            const parsed = JSON.parse(e.detail);
            if (parsed?.message) return parsed.message;
        } catch {
            /* ignore */
        }
        return e.detail;
    }
    return 'Unknown error';
}

function renderField(field, value, onChange) {
    const type = String(field?.type ?? 'string');
    const name = asText(field?.name);
    const id = `ha-field-${name}`;

    if (type === 'boolean') {
        return (
            <FormControl fullWidth key={id}>
                <InputLabel id={`${id}-label`}>{name}</InputLabel>
                <Select
                    label={name}
                    value={value?.toString() ?? 'false'}
                    labelId={`${id}-label`}
                    onChange={(e) =>
                        onChange(field.name, e.target.value === 'true')
                    }
                >
                    <MenuItem value="true">Yes</MenuItem>
                    <MenuItem value="false">No</MenuItem>
                </Select>
            </FormControl>
        );
    }

    if (type === 'select' || type === 'multi_select') {
        const options = normalizeOptions(field.options);
        return (
            <FormControl fullWidth key={id}>
                <InputLabel id={`${id}-label`}>{name}</InputLabel>
                <Select
                    label={name}
                    value={value ?? ''}
                    labelId={`${id}-label`}
                    onChange={(e) => onChange(field.name, e.target.value)}
                >
                    {options.map((opt) => (
                        <MenuItem
                            value={opt.value}
                            key={`${id}-${String(opt.value)}`}
                        >
                            {asText(opt.label)}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>
        );
    }

    const inputType =
        type === 'password'
            ? 'password'
            : type === 'integer' || type === 'float'
              ? 'number'
              : 'text';

    return (
        <TextField
            fullWidth
            key={id}
            label={name}
            type={inputType}
            value={value ?? asText(field.default)}
            onChange={(e) => onChange(field.name, e.target.value)}
            required={!!field.required}
            helperText={asText(field.description)}
        />
    );
}

export const IntegrationManager = ({ open, onClose }) => {
    const [installed, setInstalled] = useState([]);
    const [handlers, setHandlers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedHandler, setSelectedHandler] = useState(null);
    const [flow, setFlow] = useState(null);
    const [flowValues, setFlowValues] = useState({});
    const [flowError, setFlowError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [snackbar, setSnackbar] = useState(null);
    // Community (HACS-compatible) integrations
    const [communityQuery, setCommunityQuery] = useState('');
    const [communityResults, setCommunityResults] = useState([]);
    const [communityInstalled, setCommunityInstalled] = useState([]);
    const [communityStatus, setCommunityStatus] = useState({});
    const [communityBusy, setCommunityBusy] = useState(false);

    const stripApiError = (e) =>
        typeof e === 'string' ? e : e?.message || 'Unknown error';

    const refreshCommunity = async () => {
        let list = [];
        try {
            const data = await api('ha/community/installed');
            list = Array.isArray(data?.installed) ? data.installed : [];
        } catch {
            list = [];
        }
        setCommunityInstalled(list);

        // Authoritative per-domain state (handler registered? configured?
        // eligible entities?) so a chip never lies about needing a restart.
        try {
            const statuses = await Promise.all(
                list.map(async (c) => {
                    try {
                        const s = await api(
                            `ha/integrations/${c.domain}/status`
                        );
                        return [
                            c.domain,
                            s && typeof s === 'object' && !s.message
                                ? s
                                : null,
                        ];
                    } catch {
                        return [c.domain, null];
                    }
                })
            );
            setCommunityStatus(
                Object.fromEntries(statuses.filter(([, v]) => v))
            );
        } catch {
            setCommunityStatus({});
        }
    };

    const searchCommunity = async () => {
        setCommunityBusy(true);
        try {
            const data = await api(
                `ha/community?q=${encodeURIComponent(communityQuery)}`
            );
            if (data?.message && !data?.results) {
                setSnackbar({ severity: 'error', message: data.message });
                setCommunityResults([]);
            } else {
                setCommunityResults(
                    Array.isArray(data?.results) ? data.results : []
                );
            }
        } catch (e) {
            setSnackbar({ severity: 'error', message: stripApiError(e) });
        } finally {
            setCommunityBusy(false);
        }
    };

    const installCommunity = async (repo) => {
        setCommunityBusy(true);
        setSnackbar({
            severity: 'info',
            message: `Installing ${repo} and restarting Home Assistant…`,
        });
        try {
            const data = await api('ha/community/install', {
                method: 'POST',
                body: JSON.stringify({ repo }),
            });
            if (data?.message && !data?.domains) {
                setSnackbar({ severity: 'error', message: data.message });
            } else {
                setSnackbar({
                    severity: data?.warning ? 'error' : 'success',
                    message:
                        data?.warning ??
                        `${repo} installed — configure it below.`,
                });
                setCommunityResults((prev) =>
                    prev.map((r) =>
                        r.repo === repo ? { ...r, installed: true } : r
                    )
                );
                await refresh();
                await refreshCommunity();
            }
        } catch (e) {
            setSnackbar({ severity: 'error', message: stripApiError(e) });
        } finally {
            setCommunityBusy(false);
        }
    };

    const removeCommunity = async (domain) => {
        if (
            !window.confirm(
                `Remove community integration '${domain}'? Home Assistant will need a restart.`
            )
        ) {
            return;
        }
        setCommunityBusy(true);
        try {
            await api(`ha/community/${domain}`, { method: 'DELETE' });
            setSnackbar({
                severity: 'success',
                message: `${domain} removed — restart Home Assistant to unload it.`,
            });
            await refreshCommunity();
        } catch (e) {
            setSnackbar({ severity: 'error', message: stripApiError(e) });
        } finally {
            setCommunityBusy(false);
        }
    };

    const refresh = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const [entries, handlersList] = await Promise.all([
                api('ha/integrations/entry'),
                api('ha/integrations'),
            ]);
            setInstalled(entries || []);
            setHandlers(Array.isArray(handlersList) ? handlersList : []);
        } catch (e) {
            console.error(e);
            if (!silent) {
                setSnackbar({
                    severity: 'error',
                    message: 'Failed to reach Home Assistant (is it running?)',
                });
            }
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useEffect(() => {
        if (open) {
            refresh();
            refreshCommunity();
            setSelectedHandler(null);
            setFlow(null);
            setFlowValues({});
            setFlowError(null);
        }
    }, [open]);

    // While open, keep handlers / installed / per-domain status fresh so a
    // newly registered community integration stops showing "not loaded" and
    // becomes clickable without reopening the dialog.
    useEffect(() => {
        if (!open) return undefined;
        const id = setInterval(() => {
            refresh(true);
            refreshCommunity();
        }, 5000);
        return () => clearInterval(id);
    }, [open]);

    // Apply an HA config-flow result to the wizard. Handles every step type:
    // create_entry/abort (terminal), progress/external (waiting), menu + form.
    const applyStep = async (step, handler) => {
        if (!step || !step.type) {
            setFlowError('No response from Home Assistant');
            return;
        }
        if (step.type === 'create_entry') {
            setSnackbar({
                severity: 'success',
                message:
                    'Integration added! Its entities now appear in the Discovery page.',
            });
            setSelectedHandler(null);
            setFlow(null);
            setFlowValues({});
            await refresh();
            api('ha/resync', { method: 'POST' }).catch(() => {});
            return;
        }
        if (step.type === 'abort') {
            setFlowError(step.reason || 'The integration flow was aborted.');
            setSelectedHandler(null);
            setFlow(null);
            setFlowValues({});
            return;
        }
        // Non-terminal step (form / menu / progress / external).
        if (step?.errors && Object.keys(step.errors).length) {
            setFlowError(haErrorMessage({ errors: step.errors }));
        }
        setSelectedHandler(handler);
        setFlow(step);
        setFlowValues({});
    };

    // Keep the latest applyStep reachable from the progress poller.
    const applyStepRef = useRef(null);
    applyStepRef.current = applyStep;

    const startFlow = async (handler) => {
        setBusy(true);
        setFlowError(null);
        try {
            const step = await api('ha/integrations', {
                method: 'POST',
                body: JSON.stringify({ handler }),
            });
            await applyStep(step, handler);
        } catch (e) {
            setFlowError(
                haErrorMessage(e) || 'Failed to start integration flow'
            );
        } finally {
            setBusy(false);
        }
    };

    // A menu step (e.g. meross_lan's "profile"/"device") is advanced by sending
    // the chosen step id as `next_step_id` — HA then routes to async_step_<id>.
    const selectMenuOption = async (nextStepId) => {
        if (!flow) return;
        setBusy(true);
        setFlowError(null);
        try {
            const step = await api(`ha/integrations/flow/${flow.flow_id}`, {
                method: 'POST',
                body: JSON.stringify({ next_step_id: nextStepId }),
            });
            await applyStep(step, selectedHandler);
        } catch (e) {
            setFlowError(haErrorMessage(e) || 'Failed to advance the flow');
        } finally {
            setBusy(false);
        }
    };

    const submitStep = async () => {
        if (!flow) return;
        setBusy(true);
        setFlowError(null);
        try {
            const dataSchema = flow?.data_schema ?? [];
            const payload = {};
            dataSchema.forEach((field) => {
                const raw = flowValues[field.name];
                const coerced = coerceValue(raw, field.type);
                if (coerced !== undefined) payload[field.name] = coerced;
            });

            const step = await api(`ha/integrations/flow/${flow.flow_id}`, {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            await applyStep(step, selectedHandler);
        } catch (e) {
            setFlowError(haErrorMessage(e) || 'Failed to advance the flow');
        } finally {
            setBusy(false);
        }
    };

    // Poll Home Assistant while the flow is in a `progress` step.
    useEffect(() => {
        if (!flow || flow.type !== 'progress') return undefined;
        let cancelled = false;
        let timer = null;
        const tick = async () => {
            try {
                const step = await api(`ha/integrations/flow/${flow.flow_id}`);
                if (cancelled) return;
                if (step && step.type && step.type !== 'progress') {
                    await applyStepRef.current?.(step, selectedHandler);
                    return;
                }
            } catch {
                /* keep waiting */
            }
            if (!cancelled) timer = setTimeout(tick, 1500);
        };
        timer = setTimeout(tick, 1200);
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [flow, selectedHandler]);

    const cancelFlow = async () => {
        if (!flow) return;
        try {
            await api(`ha/integrations/flow/${flow.flow_id}`, {
                method: 'DELETE',
            });
        } catch (e) {
            console.error(e);
        }
        setFlow(null);
        setSelectedHandler(null);
    };

    const removeEntry = async (entryId) => {
        if (!window.confirm('Remove this integration from Home Assistant?'))
            return;
        try {
            await api(`ha/integrations/entry/${entryId}`, {
                method: 'DELETE',
            });
            setSnackbar({
                severity: 'success',
                message: 'Integration removed',
            });
            refresh();
        } catch (e) {
            setSnackbar({
                severity: 'error',
                message: 'Failed to remove integration',
            });
        }
    };

    const filteredHandlers = handlers.filter((h) =>
        handlerLabel(h).toLowerCase().includes(search.toLowerCase())
    );
    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>Home Assistant Integrations</DialogTitle>
            <DialogContent dividers>
                {loading ? (
                    <Box
                        sx={{
                            display: 'flex',
                            justifyContent: 'center',
                            p: 4,
                        }}
                    >
                        <CircularProgress />
                    </Box>
                ) : (
                    <Stack spacing={3}>
                        <Box>
                            <Typography variant="subtitle1" gutterBottom>
                                Installed
                            </Typography>
                            {installed.length === 0 ? (
                                <Typography color="text.secondary">
                                    No integrations configured yet.
                                </Typography>
                            ) : (
                                <Stack
                                    direction="row"
                                    spacing={1}
                                    flexWrap="wrap"
                                >
                                    {installed.map((entry) => (
                                        <Chip
                                            key={entry.entry_id}
                                            label={`${handlerLabel(entry.domain)}${
                                                entry.title
                                                    ? ` — ${entry.title}`
                                                    : ''
                                            }`}
                                            onDelete={() =>
                                                removeEntry(entry.entry_id)
                                            }
                                        />
                                    ))}
                                </Stack>
                            )}
                        </Box>

                        <Box>
                            <Typography variant="subtitle1" gutterBottom>
                                Community integrations (HACS)
                            </Typography>
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ mb: 1 }}
                            >
                                Install community integrations (for example
                                Meross) straight from GitHub. Home Assistant
                                restarts automatically to activate them.
                            </Typography>
                            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                                <TextField
                                    fullWidth
                                    size="small"
                                    label="Search community integrations (e.g. meross)"
                                    value={communityQuery}
                                    onChange={(e) =>
                                        setCommunityQuery(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter')
                                            searchCommunity();
                                    }}
                                />
                                <Button
                                    variant="contained"
                                    onClick={searchCommunity}
                                    disabled={communityBusy}
                                >
                                    {communityBusy ? 'Working…' : 'Search'}
                                </Button>
                            </Stack>
                            <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
                                <Stack
                                    direction="row"
                                    spacing={1}
                                    flexWrap="wrap"
                                >
                                    {communityResults.map((r) => (
                                        <Chip
                                            key={r.repo}
                                            label={
                                                r.installed
                                                    ? `${r.repo} ✓`
                                                    : r.repo
                                            }
                                            clickable={!r.installed}
                                            color={
                                                r.installed
                                                    ? 'success'
                                                    : 'primary'
                                            }
                                            variant="outlined"
                                            onClick={() =>
                                                !r.installed &&
                                                !communityBusy &&
                                                installCommunity(r.repo)
                                            }
                                        />
                                    ))}
                                </Stack>
                            </Box>
                            {communityInstalled.length > 0 && (
                                <>
                                    <Typography
                                        variant="subtitle2"
                                        sx={{ mt: 2 }}
                                        gutterBottom
                                    >
                                        Installed community integrations
                                    </Typography>
                                    <Stack
                                        direction="row"
                                        spacing={1}
                                        flexWrap="wrap"
                                    >
                                        {communityInstalled.map((c) => {
                                            const st =
                                                communityStatus[c.domain];
                                            const handlerReady = st
                                                ? !!st.handlerReady
                                                : handlers.includes(c.domain);
                                            const configured = st
                                                ? !!st.configured
                                                : false;
                                            const base = `${c.domain}${
                                                c.version
                                                    ? ` — ${c.version}`
                                                    : ''
                                            }`;
                                            const label = !handlerReady
                                                ? `${base} (not loaded)`
                                                : configured
                                                  ? `${base} ✓`
                                                  : base;
                                            return (
                                                <Chip
                                                    key={c.domain}
                                                    label={label}
                                                    color={
                                                        !handlerReady
                                                            ? 'warning'
                                                            : configured
                                                              ? 'success'
                                                              : 'primary'
                                                    }
                                                    variant={
                                                        handlerReady
                                                            ? 'filled'
                                                            : 'outlined'
                                                    }
                                                    clickable={handlerReady}
                                                    onClick={
                                                        handlerReady
                                                            ? () =>
                                                                  !busy &&
                                                                  startFlow(
                                                                      c.domain
                                                                  )
                                                            : undefined
                                                    }
                                                    onDelete={() =>
                                                        removeCommunity(
                                                            c.domain
                                                        )
                                                    }
                                                />
                                            );
                                        })}
                                    </Stack>
                                    {communityInstalled.some(
                                        (c) =>
                                            communityStatus[c.domain] &&
                                            !communityStatus[c.domain]
                                                .handlerReady
                                    ) && (
                                        <Typography
                                            variant="caption"
                                            color="text.secondary"
                                            display="block"
                                            sx={{ mt: 1 }}
                                        >
                                            Some integrations are not loaded by
                                            Home Assistant yet — they may still
                                            be starting, failed to import, or
                                            HA_CONFIG_DIR may be wrong. Check
                                            the HA log at
                                            /api/ha/error-log?grep=domain
                                        </Typography>
                                    )}
                                </>
                            )}
                        </Box>

                        {flowError && (
                            <Alert
                                severity="error"
                                onClose={() => setFlowError(null)}
                            >
                                {flowError}
                            </Alert>
                        )}

                        {selectedHandler && flow ? (
                            <Box>
                                <Typography variant="subtitle1" gutterBottom>
                                    Configure {handlerLabel(selectedHandler)}
                                </Typography>
                                {asText(flow.title) && (
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        sx={{ mb: 2 }}
                                    >
                                        {asText(flow.title)}
                                    </Typography>
                                )}

                                {flow.type === 'progress' ? (
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 2,
                                            py: 2,
                                        }}
                                    >
                                        <CircularProgress size={22} />
                                        <Typography color="text.secondary">
                                            Waiting
                                            {flow.progress_action
                                                ? ` — ${flow.progress_action}`
                                                : '…'}
                                        </Typography>
                                    </Box>
                                ) : flow.type === 'external' ||
                                  flow.type === 'external_done' ? (
                                    <Alert severity="info" sx={{ my: 1 }}>
                                        This integration needs an external step
                                        (authorize it from Home Assistant).
                                        {flow.url ? ` URL: ${flow.url}` : ''}
                                    </Alert>
                                ) : flow.type === 'menu' ? (
                                    <Stack spacing={1} sx={{ mt: 1 }}>
                                        {menuChoices(flow).map((opt) => (
                                            <Button
                                                key={opt.value}
                                                variant="outlined"
                                                disabled={busy}
                                                onClick={() =>
                                                    selectMenuOption(opt.value)
                                                }
                                            >
                                                {opt.label}
                                            </Button>
                                        ))}
                                    </Stack>
                                ) : (
                                    <Stack spacing={2}>
                                        {(flow?.data_schema ?? []).map(
                                            (field) =>
                                                renderField(
                                                    field,
                                                    flowValues[field.name],
                                                    (name, val) =>
                                                        setFlowValues(
                                                            (prev) => ({
                                                                ...prev,
                                                                [name]: val,
                                                            })
                                                        )
                                                )
                                        )}
                                    </Stack>
                                )}
                            </Box>
                        ) : (
                            <Box>
                                <Typography variant="subtitle1" gutterBottom>
                                    Add a device integration
                                </Typography>
                                <TextField
                                    fullWidth
                                    label="Search integrations"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    sx={{ mb: 2 }}
                                />
                                <Box sx={{ maxHeight: 240, overflow: 'auto' }}>
                                    <Stack
                                        direction="row"
                                        spacing={1}
                                        flexWrap="wrap"
                                    >
                                        {filteredHandlers.map((h) => (
                                            <Chip
                                                key={h}
                                                label={handlerLabel(h)}
                                                clickable
                                                color="primary"
                                                variant="outlined"
                                                onClick={() => startFlow(h)}
                                            />
                                        ))}
                                    </Stack>
                                </Box>
                            </Box>
                        )}
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                {selectedHandler && flow ? (
                    <>
                        <Button onClick={cancelFlow} disabled={busy}>
                            Cancel
                        </Button>
                        {flow.type === 'form' && (
                            <Button
                                variant="contained"
                                onClick={submitStep}
                                disabled={busy}
                            >
                                {busy ? 'Working…' : 'Continue'}
                            </Button>
                        )}
                    </>
                ) : (
                    <>
                        <Button
                            onClick={() => {
                                refresh();
                                refreshCommunity();
                            }}
                            disabled={loading}
                        >
                            Refresh
                        </Button>
                        <Button onClick={onClose}>Close</Button>
                    </>
                )}
            </DialogActions>

            <Snackbar
                open={!!snackbar}
                autoHideDuration={4000}
                onClose={() => setSnackbar(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    severity={snackbar?.severity ?? 'info'}
                    variant="filled"
                    onClose={() => setSnackbar(null)}
                >
                    {snackbar?.message}
                </Alert>
            </Snackbar>
        </Dialog>
    );
};
