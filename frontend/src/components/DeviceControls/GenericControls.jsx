import React from 'react';
import {
    Box,
    FormControl,
    FormControlLabel,
    InputLabel,
    MenuItem,
    Select,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import { updateState } from './utils';
import { DebouncedSlider } from './DebouncedSlider';

/**
 * Debounced text/number input that commits on blur or Enter.
 */
const TextControl = ({ field, value, onChange, disabled = false }) => {
    const [draft, setDraft] = React.useState(String(value ?? ''));
    React.useEffect(() => setDraft(String(value ?? '')), [value]);

    const commit = () => {
        const next = field.type === 'number' ? Number(draft) : draft;
        if (next !== value) onChange(next);
    };

    return (
        <TextField
            label={field.label}
            value={draft}
            type={field.type === 'number' ? 'number' : 'text'}
            size="small"
            fullWidth
            disabled={disabled}
            sx={{ my: 1 }}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => event.key === 'Enter' && commit()}
        />
    );
};

/**
 * Renders a single `StatePropertySchema` field into a MUI control / readout.
 * Readonly (telemetry) properties are shown as read-only text rows.
 */
export const SchemaField = ({ field, value, onChange, disabled = false }) => {
    if (field.readonly) {
        return (
            <Box
                key={field.key}
                sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    my: 0.5,
                }}
            >
                <Typography variant="body2" color="text.secondary">
                    {field.label}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {value ?? '-'}
                    {field.unit ? ` ${field.unit}` : ''}
                </Typography>
            </Box>
        );
    }

    switch (field.type) {
        case 'boolean':
            return (
                <FormControlLabel
                    key={field.key}
                    control={
                        <Switch
                            checked={!!value}
                            disabled={disabled}
                            onChange={(event) => onChange(event.target.checked)}
                        />
                    }
                    label={field.label}
                    sx={{ my: 0.5 }}
                />
            );
        case 'enum':
            return (
                <FormControl key={field.key} fullWidth sx={{ my: 0.5 }}>
                    <InputLabel>{field.label}</InputLabel>
                    <Select
                        value={value ?? ''}
                        label={field.label}
                        disabled={disabled}
                        onChange={(event) => onChange(event.target.value)}
                    >
                        {(field.options ?? []).map((option) => (
                            <MenuItem key={option.value} value={option.value}>
                                {option.label}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            );
        case 'range':
            return (
                <Box key={field.key} sx={{ my: 1 }}>
                    <Typography variant="body2" gutterBottom>
                        {field.label}: {value ?? field.min}
                        {field.unit ? ` ${field.unit}` : ''}
                    </Typography>
                    <DebouncedSlider
                        value={value ?? field.min}
                        min={field.min ?? 0}
                        max={field.max ?? 100}
                        step={field.step ?? 1}
                        size="small"
                        disabled={disabled}
                        valueLabelDisplay="auto"
                        onChangeCommitted={onChange}
                    />
                </Box>
            );
        case 'number':
        case 'string':
        default:
            return (
                <TextControl
                    key={field.key}
                    field={field}
                    value={value}
                    onChange={onChange}
                    disabled={disabled}
                />
            );
    }
};

/**
 * Generic provider-agnostic controls. Walks a `capabilities.state[]` schema
 * and builds the matching MUI control for each editable/readonly property.
 */
export const PropertyControls = ({ device, schema = [], onStateChange }) => {
    const props = device?.state?.properties ?? {};

    if (!schema.length) {
        return (
            <Typography variant="body2" color="text.secondary">
                Aucune commande avancée pour cet appareil.
            </Typography>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, p: 1 }}>
            {schema.map((field) => (
                <SchemaField
                    key={field.key}
                    field={field}
                    value={props[field.key]}
                    onChange={(value) =>
                        updateState(
                            device,
                            { properties: { [field.key]: value } },
                            onStateChange
                        )
                    }
                />
            ))}
        </Box>
    );
};

export default PropertyControls;