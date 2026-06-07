import React from 'react';
import { withTheme } from '@rjsf/core';
import { Theme as MuiTheme } from '@rjsf/mui';
import validator from '@rjsf/validator-ajv8';
import { useSettings, useSettingsSchema } from '../state/settingsHooks';
import { Box, Paper, Chip, Typography, Button } from '@mui/material';
import { api } from '../api/charlie';
import { settings } from './../state/settings';

const Form = withTheme(MuiTheme);

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
    const schemas = useSettingsSchema();
    const $settings = useSettings();

    const handleChange = ({ formData }) => {
        api('settings', { method: 'PUT', body: JSON.stringify(formData) });
        settings.update(formData);
    };

    return (
        <Box>
            <Paper sx={{ p: 2 }}>
                <Typography mb={2} color="green">
                    You need refresh page to reload settings. Restart tag
                    requires server restart.
                </Typography>
                <Button
                    sx={{ mb: 1 }}
                    onClick={() => api('restart', { method: 'POST' })}
                >
                    Restart server
                </Button>
                <Button
                    sx={{ mb: 1, ml: 2 }}
                    onClick={() =>
                        api('notifications', {
                            method: 'POST',
                            body: JSON.stringify({
                                type: 'push',
                                title: 'TEST',
                                body: 'This is a test',
                            }),
                        })
                    }
                >
                    Test push notification
                </Button>
                <Form
                    schema={schemas}
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
