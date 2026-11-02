import React, { useState } from 'react';
import {
    Box,
    Button,
    Divider,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/charlie';

const mono = { fontFamily: 'monospace' };

const Info = ({ label, value, monospace = false }) =>
    value ? (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline' }}>
            <Typography
                color="text.secondary"
                variant="body2"
                sx={{ minWidth: 90 }}
            >
                {label}
            </Typography>
            <Typography variant="body2" sx={monospace ? mono : undefined}>
                {value}
            </Typography>
        </Box>
    ) : null;

/**
 * What the device reports on every connect: its versions, its type and the
 * MAC address the server uses to identify it (the settings follow that MAC,
 * not the ip).
 */
export const EchoDeviceInfo = ({ echo, onReload }) => {
    const { t } = useTranslation();
    const [asking, setAsking] = useState(false);

    const askVersions = () => {
        setAsking(true);
        api(`echo/${echo.id}/versions`, { method: 'POST' })
            .catch(() => null)
            .finally(() =>
                // The device answers over the WebSocket a moment later.
                setTimeout(() => {
                    setAsking(false);
                    onReload?.();
                }, 1500)
            );
    };

    return (
        <Box sx={{ mb: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="h6">
                    {echo.deviceType ?? t('echo.device')}
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Tooltip title={t('echo.askVersionsHint')}>
                    <span>
                        <Button
                            size="small"
                            startIcon={<RefreshIcon />}
                            onClick={askVersions}
                            disabled={asking}
                        >
                            {asking ? t('echo.refreshing') : t('echo.refreshInfo')}
                        </Button>
                    </span>
                </Tooltip>
            </Stack>
            <Divider sx={{ my: 1 }} />
            <Stack spacing={0.5}>
                <Info label={t('echo.ip')} value={echo.ip} monospace />
                <Info
                    label={t('echo.mac')}
                    value={echo.mac ?? t('echo.macNotReported')}
                    monospace
                />
                <Info label={t('common.type')} value={echo.deviceType} />
                <Info label={t('echo.library')} value={echo.versions?.lib} />
                <Info label={t('echo.firmware')} value={echo.versions?.device} />
                <Info
                    label={t('echo.lastSeen')}
                    value={
                        echo.lastSeen
                            ? new Date(echo.lastSeen).toLocaleString()
                            : undefined
                    }
                />
            </Stack>
        </Box>
    );
};