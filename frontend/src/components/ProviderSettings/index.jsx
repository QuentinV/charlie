import React, { useEffect, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/charlie';
import { SchemaField } from '../DeviceControls/GenericControls';

/**
 * Provider-row settings, rendered from the schema its codesource declares
 * (`ProvidersApis.settings` → `GET /api/providers/:id/settings`).
 *
 * It is the same idea as a device's `capabilities.state`: the module says what
 * fields exist, the dialog lays them out, and the values live in
 * `Provider.properties` (+ the reserved `url`). Adding settings to a provider is
 * a backend declaration, never a new form here — the Home Assistant wizard keeps
 * its own dialog because it renders a *remote* schema (HA's config flows).
 */
export const ProviderSettings = ({ provider, onClose, onSaved }) => {
    const { t } = useTranslation();
    const [fields, setFields] = useState([]);
    const [values, setValues] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!provider?._id) return undefined;
        let cancelled = false;

        setLoading(true);
        setError('');
        api(`providers/${provider._id}/settings`)
            .then((data) => {
                if (cancelled) return;
                setFields(data?.fields ?? []);
                setValues(data?.values ?? {});
            })
            .catch((e) => {
                console.error(e);
                if (!cancelled) setError(t('providers.settingsLoadFailed'));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
        // Refetch on the provider only: the labels are re-rendered by `t` on a
        // language change, the values never need a second round-trip.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [provider?._id]);

    const save = async () => {
        try {
            setSaving(true);
            await api(`providers/${provider._id}/settings`, {
                method: 'PUT',
                body: JSON.stringify({ values }),
            });
            onSaved?.();
            onClose?.();
        } catch (e) {
            console.error(e);
            setError(t('providers.saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={!!provider} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                {t('providers.settingsTitle', {
                    name: provider?.name ?? '',
                })}
            </DialogTitle>
            <DialogContent dividers>
                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                        <CircularProgress size={24} />
                    </Box>
                ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        {error && <Alert severity="error">{error}</Alert>}
                        {!error && !fields.length && (
                            <Typography variant="body2" color="text.secondary">
                                {t('providers.settingsNone')}
                            </Typography>
                        )}
                        {fields.map((field) => (
                            <SchemaField
                                key={field.key}
                                field={field}
                                value={values[field.key]}
                                onChange={(value) =>
                                    setValues((prev) => ({
                                        ...prev,
                                        [field.key]: value,
                                    }))
                                }
                            />
                        ))}
                        {!!fields.length && (
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ mt: 1 }}
                            >
                                {t('providers.settingsHint')}
                            </Typography>
                        )}
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t('common.cancel')}</Button>
                <Button
                    variant="contained"
                    onClick={save}
                    disabled={loading || saving || !fields.length}
                >
                    {t('common.update')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ProviderSettings;