import React from 'react';
import { withTheme } from '@rjsf/core';
import { Theme as MuiTheme } from '@rjsf/mui';
import validator from '@rjsf/validator-ajv8';
import { useSettings, useSettingsSchema } from '../state/settingsHooks';
import { Box, Paper, Typography } from '@mui/material';
import { api } from '../api/charlie';
import { settings } from './../state/settings';

const Form = withTheme(MuiTheme);

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
                    You need refresh page to reload settings
                </Typography>
                <Form
                    schema={schemas}
                    validator={validator}
                    onChange={handleChange}
                    formData={$settings}
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
