import React from 'react';
import {
    Box,
    Checkbox,
    FormControl,
    FormControlLabel,
    FormHelperText,
    InputLabel,
    ListItemText,
    MenuItem,
    Select,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import { updateState } from './utils';
import { DebouncedSlider } from './DebouncedSlider';
import { useTranslation } from 'react-i18next';

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
 * `multienum`: several `options` at once, carried as a CSV string (the flat
 * property vocabulary has no arrays — a camera's vision modes are one). Each
 * option's `description` is shown beside it, and the field's own `description`
 * as helper text: a mode is a preset, so what it does must be readable.
 */
const MultiEnumControl = ({ field, value, onChange, disabled = false }) => {
    const options = field.options ?? [];
    const selected = String(value ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);

    return (
        <FormControl key={field.key} fullWidth sx={{ my: 0.5 }}>
            <InputLabel>{field.label}</InputLabel>
            <Select
                multiple
                value={selected}
                label={field.label}
                disabled={disabled}
                onChange={(event) => onChange(event.target.value.join(','))}
                renderValue={(ids) =>
                    ids
                        .map(
                            (id) =>
                                options.find((option) => option.value === id)
                                    ?.label ?? id
                        )
                        .join(', ')
                }
            >
                {options.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                        <Checkbox checked={selected.includes(option.value)} />
                        <ListItemText
                            primary={option.label}
                            secondary={option.description}
                        />
                    </MenuItem>
                ))}
            </Select>
            {field.description && (
                <FormHelperText>{field.description}</FormHelperText>
            )}
        </FormControl>
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
                    {field.description && (
                        <FormHelperText>{field.description}</FormHelperText>
                    )}
                </FormControl>
            );
        case 'multienum':
            return (
                <MultiEnumControl
                    field={field}
                    value={value}
                    onChange={onChange}
                    disabled={disabled}
                />
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
    const { t } = useTranslation();
    const props = device?.state?.properties ?? {};

    if (!schema.length) {
        return (
            <Typography variant="body2" color="text.secondary">
                {t('deviceControls.noAdvancedCommands')}
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