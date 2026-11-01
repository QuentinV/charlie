import React, { useState, useRef } from 'react';
import {
    Dialog,
    Typography,
    Box,
    CircularProgress,
    Button,
} from '@mui/material';
import { api } from '../../api/charlie';
import { useTranslation } from 'react-i18next';

export const NfcJsonReader = ({ children }) => {
    const { t } = useTranslation();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [status, setStatus] = useState('');

    const pressTimer = useRef(null);

    const startScan = async () => {
        try {
            if (!('NDEFReader' in window)) {
                setStatus(t('nfc.unsupported'));
                setDialogOpen(true);
                return;
            }

            const ndef = new NDEFReader();
            setStatus(t('nfc.scanning'));
            setDialogOpen(true);

            await ndef.scan();

            ndef.onreadingerror = () => {
                setStatus(t('nfc.readError'));
            };

            ndef.onreading = async (event) => {
                setStatus(t('nfc.detected'));

                const decoder = new TextDecoder();
                let jsonString = null;

                for (const record of event.message.records) {
                    if (
                        record.recordType === 'text' ||
                        record.recordType === 'mime'
                    ) {
                        jsonString = decoder.decode(record.data);
                    }
                }

                if (!jsonString) {
                    setStatus(t('nfc.noJson'));
                    return;
                }

                let parsed;
                try {
                    parsed = JSON.parse(jsonString);
                } catch {
                    setStatus(t('nfc.invalidJson'));
                    return;
                }

                const { m, u, d } = parsed;

                if (!u) {
                    setStatus(t('nfc.missingField'));
                    return;
                }

                const method = m ?? 'GET';

                setStatus(
                    t('nfc.calling', {
                        method,
                        url: u,
                        body: JSON.stringify(d ?? ''),
                    })
                );

                try {
                    const res = await api(u, {
                        method,
                        headers: { 'Content-Type': 'application/json' },
                        body:
                            method !== 'GET'
                                ? JSON.stringify(d || {})
                                : undefined,
                    });

                    setStatus(t('nfc.completed'));

                    setTimeout(() => setDialogOpen(false), 2000);
                } catch (err) {
                    setStatus(t('nfc.failed', { message: err.message }));
                }
            };
        } catch (err) {
            setStatus(t('nfc.scanFailed', { message: err.message }));
            setDialogOpen(true);
        }
    };

    const handlePressStart = (e) => {
        pressTimer.current = setTimeout(() => {
            startScan();
        }, 600);
    };

    const handlePressEnd = () => {
        clearTimeout(pressTimer.current);
    };

    return (
        <div
            style={{
                userSelect: 'none',
                touchAction: 'none',
                display: 'flex',
                gap: '10px',
                alignItems: 'center',
            }}
            onTouchStart={handlePressStart}
            onTouchEnd={handlePressEnd}
            onMouseDown={handlePressStart}
            onMouseUp={handlePressEnd}
        >
            {children}
            {/* Full-screen status dialog */}
            <Dialog fullScreen open={dialogOpen}>
                <Box
                    sx={{
                        height: '100vh',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                        p: 4,
                        textAlign: 'center',
                    }}
                >
                    <CircularProgress sx={{ mb: 3 }} />
                    <Typography variant="h5" sx={{ mb: 2 }}>
                        {status}
                    </Typography>
                </Box>
            </Dialog>
        </div>
    );
};
