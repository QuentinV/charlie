import React from 'react';
import { Chip, Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * Document type of a scan: "auto" (the model classifies) or a module the caller
 * names. Naming the type is the fast path — it saves the classifier call — and
 * the way to correct a wrong detection without photographing the paper again.
 */
export const TypePicker = ({ modules, value, onChange, disabled }) => {
    const { t } = useTranslation();

    return (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Chip
                label={t('vision.typeAuto')}
                color={!value ? 'primary' : 'default'}
                variant={!value ? 'filled' : 'outlined'}
                onClick={() => !disabled && onChange('')}
            />
            {(modules ?? []).map((module) => (
                <Chip
                    key={module.id}
                    label={module.label}
                    color={value === module.id ? 'primary' : 'default'}
                    variant={value === module.id ? 'filled' : 'outlined'}
                    onClick={() => !disabled && onChange(module.id)}
                />
            ))}
        </Stack>
    );
};

export default TypePicker;
