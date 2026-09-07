import React, { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { api } from '../../api/charlie';
import { SchemaField } from './GenericControls';

/**
 * "Fonctions" section. Iterates the device `capabilities.functions[]` and
 * builds a typed form (from `inputSchema`) that calls the existing
 * `POST devices/:id/functions/:name` endpoint when executed.
 */
export const DeviceFunctions = ({ device, functions = [] }) => {
    const [forms, setForms] = useState(() => ({}));

    if (!functions.length) return null;

    const setValue = (name, key, value) =>
        setForms((prev) => ({
            ...prev,
            [name]: { ...(prev[name] ?? {}), [key]: value },
        }));

    const exec = async (name, inputSchema) => {
        const form = forms[name] ?? {};
        const body = Object.fromEntries(
            (inputSchema ?? [])
                .filter((f) => form[f.key] !== undefined)
                .map((f) => [f.key, form[f.key]])
        );
        await api(`devices/${device?._id}/functions/${name}`, {
            method: 'POST',
            body: JSON.stringify(body),
        });
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Typography variant="subtitle2">Fonctions</Typography>
            {functions.map((f) => {
                const inputSchema = f.inputSchema ?? [];
                const hasForm = inputSchema.length > 0;
                return (
                    <Box
                        key={f.name}
                        sx={{
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            p: 1.5,
                            mt: 0.5,
                        }}
                    >
                        <Typography variant="subtitle2">{f.name}</Typography>
                        {f.description && (
                            <Typography
                                variant="caption"
                                color="text.secondary"
                            >
                                {f.description}
                            </Typography>
                        )}
                        {hasForm &&
                            inputSchema.map((field) => (
                                <SchemaField
                                    key={field.key}
                                    field={field}
                                    value={forms[f.name]?.[field.key]}
                                    onChange={(value) =>
                                        setValue(f.name, field.key, value)
                                    }
                                />
                            ))}
                        <Box sx={{ mt: 0.5, textAlign: 'right' }}>
                            <Button
                                variant="contained"
                                size="small"
                                onClick={() => exec(f.name, inputSchema)}
                            >
                                Exécuter
                            </Button>
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
};

export default DeviceFunctions;