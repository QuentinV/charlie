import React, { useState } from 'react';
import {
    Box,
    Button,
    CircularProgress,
    Stack,
    Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { SchemaField } from '../GenericControls';
import { SECTION_LABEL } from '../types/typeStyles';
import { callDeviceFunction } from '../utils';

/**
 * Domain-agnostic renderer for `capabilities.functions`.
 *
 * The provider advertises what the gateway's services catalogue offers (a lock
 * service, a vacuum command, a fan percentage…), so this list is the UI for
 * every device type without a hand-authored panel — no per-brand behaviour, no
 * per-domain hardcoded command: each function's own `inputSchema` decides the
 * controls, and a function HA leaves free stays a text field.
 */
const labelOf = (name) =>
    String(name)
        .split('.')
        .slice(-1)[0]
        .replace(/_/g, ' ')
        .replace(/^./, (character) => character.toUpperCase());

/** Field copy the shared renderer understands (options -> enum control). */
const asControl = (field) =>
    field.options?.length ? { ...field, type: 'enum' } : field;

const FunctionRow = ({ device, fn }) => {
    const fields = (fn.inputSchema ?? []).filter((field) => !field.readonly);
    // Booleans start as `false` (a switch is always in a known state), every
    // other field waits for a value: a command with no field is one click.
    const [values, setValues] = useState(() =>
        Object.fromEntries(
            fields
                .filter((field) => field.type === 'boolean')
                .map((field) => [field.key, false])
        )
    );
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const required = fields.filter(
        (field) => values[field.key] === undefined || values[field.key] === ''
    );
    const canCall =
        !busy && (fields.length === 0 || required.length < fields.length);

    const call = async () => {
        const params = {};
        fields.forEach((field) => {
            const value = values[field.key];
            if (value === undefined || value === '') return;
            params[field.key] =
                field.type === 'number' && value !== '' ? Number(value) : value;
        });

        setBusy(true);
        setError('');
        try {
            await callDeviceFunction(
                device?._id,
                fn.name,
                Object.keys(params).length ? params : undefined
            );
        } catch (e) {
            setError(e?.message ?? 'Commande impossible');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box
            sx={{
                py: 1,
                borderTop: '1px solid rgba(255,255,255,0.06)',
            }}
        >
            <Stack direction="row" alignItems="center" spacing={1}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {fn.description ?? labelOf(fn.name)}
                    </Typography>
                    <Typography
                        sx={{ fontSize: 11, color: 'text.disabled' }}
                        noWrap
                    >
                        {fn.name}
                    </Typography>
                </Box>
                <Button
                    size="small"
                    variant="outlined"
                    disabled={!canCall}
                    onClick={call}
                    startIcon={
                        busy ? (
                            <CircularProgress size={14} color="inherit" />
                        ) : (
                            <SendIcon fontSize="small" />
                        )
                    }
                    sx={{ textTransform: 'none', flexShrink: 0 }}
                >
                    {labelOf(fn.name)}
                </Button>
            </Stack>

            {fields.map((field) => (
                <SchemaField
                    key={field.key}
                    field={asControl(field)}
                    value={values[field.key]}
                    onChange={(value) =>
                        setValues((current) => ({
                            ...current,
                            [field.key]: value,
                        }))
                    }
                    disabled={busy}
                />
            ))}

            {error && (
                <Typography sx={{ fontSize: 11, color: 'error.main', mt: 0.5 }}>
                    {error}
                </Typography>
            )}
        </Box>
    );
};

export const FunctionList = ({ device, functions = [] }) => {
    const visible = functions.filter((fn) => !fn.hidden);
    if (!visible.length) return null;

    return (
        <Box sx={{ p: 1 }}>
            <Typography sx={SECTION_LABEL}>Commandes</Typography>
            {visible.map((fn) => (
                <FunctionRow key={fn.name} device={device} fn={fn} />
            ))}
        </Box>
    );
};

export default FunctionList;
