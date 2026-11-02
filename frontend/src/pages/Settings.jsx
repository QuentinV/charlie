import React from 'react';
import { withTheme } from '@rjsf/core';
import { Theme as MuiTheme } from '@rjsf/mui';
import validator from '@rjsf/validator-ajv8';
import { useTranslation } from 'react-i18next';
import { useSettings, useSettingsSchema } from '../state/settingsHooks';
import { Box, Paper, Chip, Typography, Button, Divider } from '@mui/material';
import { api } from '../api/charlie';
import { settings } from './../state/settings';
import { Security } from '../components/Security';

const Form = withTheme(MuiTheme);

/**
 * Overlays translated titles, descriptions and tags onto a *copy* of the
 * backend settings schema. Keys follow one uniform pattern derived from the
 * schema property key — no mapping table:
 *   `settings.<schemaKey>.title` / `settings.<schemaKey>.description`
 *   `settings.tags.<tag>`
 * Missing keys fall back to the original (English) backend text.
 */
function localizeSchema(schema, t) {
    if (!schema || typeof schema !== 'object') return schema;

    const next = { ...schema };

    if (next.properties) {
        next.properties = Object.fromEntries(
            Object.entries(next.properties).map(([key, value]) => [
                key,
                {
                    ...localizeSchema(value, t),
                    title: t(`settings.${key}.title`, {
                        defaultValue: value.title,
                    }),
                    ...(value.description
                        ? {
                              description: t(`settings.${key}.description`, {
                                  defaultValue: value.description,
                              }),
                          }
                        : {}),
                },
            ])
        );
    }

    if (Array.isArray(next.tags)) {
        next.tags = next.tags.map((tag) =>
            t(`settings.tags.${tag}`, { defaultValue: tag })
        );
    }

    return next;
}

function CustomFieldTemplate(props) {
    const { children, schema } = props;

    return (
        <>
            {children}

            <Box display="flex" flexDirection="row" gap={1}>
                {schema.tags &&
                    schema.tags.map((tag) => (
                        <Chip
                            key={tag}
                            label={tag}
                            color={
                                tag === 'restart'
                                    ? 'primary'
                                    : tag === 'Experimental'
                                      ? 'warning'
                                      : 'green'
                            }
                            variant="outlined"
                            sx={{ height: 20, fontSize: '0.65rem' }}
                        />
                    ))}
            </Box>
        </>
    );
}

export default function SettingsPage() {
    const { t, i18n } = useTranslation();
    const schemas = useSettingsSchema();
    const $settings = useSettings();

    const localizedSchemas = React.useMemo(
        () => localizeSchema(schemas, t),
        // Recompute on language change as well as schema change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [schemas, t, i18n.language]
    );

    const handleChange = ({ formData }) => {
        api('settings', { method: 'PUT', body: JSON.stringify(formData) });
        settings.update(formData);
    };

    return (
        <Box>
            <Paper sx={{ p: 2 }}>
                <Security />
                <Divider sx={{ my: 2 }} />
                <Typography mb={2} color="green">
                    {t('settings.refreshHint')}
                </Typography>
                <Button
                    sx={{ mb: 1 }}
                    onClick={() => api('restart', { method: 'POST' })}
                >
                    {t('settings.restartServer')}
                </Button>
                <Button
                    sx={{ mb: 1, ml: 2 }}
                    onClick={() =>
                        api('notifications', {
                            method: 'POST',
                            body: JSON.stringify({
                                type: 'push',
                                title: t('settings.testPushTitle'),
                                body: t('settings.testPushBody'),
                            }),
                        })
                    }
                >
                    {t('settings.testPush')}
                </Button>
                <Form
                    schema={localizedSchemas}
                    validator={validator}
                    onChange={handleChange}
                    formData={$settings}
                    templates={{ FieldTemplate: CustomFieldTemplate }}
                    uiSchema={{
                        'ui:submitButtonOptions': {
                            norender: true,
                        },
                        'ui:options': {
                            mui: {
                                rjsfSlotProps: {
                                    objectGridContainer: {
                                        spacing: 1,
                                    },
                                },
                            },
                        },
                    }}
                />
            </Paper>
        </Box>
    );
}
