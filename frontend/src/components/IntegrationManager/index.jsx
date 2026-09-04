import React, { useEffect, useState } from 'react';
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
};

function handlerLabel(handler) {
    return HANDLER_LABELS[handler?.toLowerCase()] || handler;
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
    const id = `ha-field-${field.name}`;

    if (type === 'boolean') {
        return (
            <FormControl fullWidth key={id}>
                <InputLabel id={`${id}-label`}>{field.name}</InputLabel>
                <Select
                    label={field.name}
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
        const options = Array.isArray(field.options)
            ? field.options
            : Object.entries(field.options ?? {}).map(([k, v]) => ({
                  value: k,
                  label: typeof v === 'string' ? v : k,
              }));
        return (
            <FormControl fullWidth key={id}>
                <InputLabel id={`${id}-label`}>{field.name}</InputLabel>
                <Select
                    label={field.name}
                    value={value ?? ''}
                    labelId={`${id}-label`}
                    onChange={(e) => onChange(field.name, e.target.value)}
                >
                    {options.map((opt) => (
                        <MenuItem value={opt.value} key={opt.value}>
                            {opt.label}
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
            label={field.name}
            type={inputType}
            value={value ?? field.default ?? ''}
            onChange={(e) => onChange(field.name, e.target.value)}
            required={!!field.required}
            helperText={field.description ?? ''}
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

    const refresh = async () => {
        setLoading(true);
        try {
            const [entries, handlersList] = await Promise.all([
                api('ha/integrations/entry'),
                api('ha/integrations'),
            ]);
            setInstalled(entries || []);
            setHandlers(handlersList || []);
        } catch (e) {
            console.error(e);
            setSnackbar({
                severity: 'error',
                message: 'Failed to reach Home Assistant (is it running?)',
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) {
            refresh();
            setSelectedHandler(null);
            setFlow(null);
            setFlowValues({});
            setFlowError(null);
        }
    }, [open]);

    const startFlow = async (handler) => {
        setBusy(true);
        setFlowError(null);
        try {
            const step = await api('ha/integrations', {
                method: 'POST',
                body: JSON.stringify({ handler }),
            });
            if (step?.type === 'create_entry') {
                setSnackbar({
                    severity: 'success',
                    message: 'Integration added!',
                });
                setSelectedHandler(null);
                refresh();
            } else if (step?.type === 'abort') {
                setFlowError(
                    step.reason || 'The integration flow was aborted.'
                );
                setSelectedHandler(null);
            } else {
                setSelectedHandler(handler);
                setFlow(step);
                setFlowValues({});
            }
        } catch (e) {
            setFlowError(
                haErrorMessage(e) || 'Failed to start integration flow'
            );
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

            if (step?.type === 'create_entry') {
                setSnackbar({
                    severity: 'success',
                    message: 'Integration added!',
                });
                setSelectedHandler(null);
                setFlow(null);
                refresh();
                api('ha/resync', { method: 'POST' }).catch(() => {});
            } else if (step?.type === 'abort') {
                setFlowError(
                    step.reason || 'The integration flow was aborted.'
                );
                setSelectedHandler(null);
                setFlow(null);
            } else {
                // A 'form' step (possibly with validation errors, e.g. wrong
                // security code) → stay in the wizard and show the errors.
                if (step?.errors && Object.keys(step.errors).length) {
                    setFlowError(haErrorMessage({ errors: step.errors }));
                }
                setFlow(step);
                setFlowValues({});
            }
        } catch (e) {
            setFlowError(haErrorMessage(e) || 'Failed to advance the flow');
        } finally {
            setBusy(false);
        }
    };

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
                                {(flow?.data_schema ?? []).map((field) =>
                                    renderField(
                                        field,
                                        flowValues[field.name],
                                        (name, val) =>
                                            setFlowValues((prev) => ({
                                                ...prev,
                                                [name]: val,
                                            }))
                                    )
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
                        <Button
                            variant="contained"
                            onClick={submitStep}
                            disabled={busy}
                        >
                            {busy ? 'Working…' : 'Continue'}
                        </Button>
                    </>
                ) : (
                    <Button onClick={onClose}>Close</Button>
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
