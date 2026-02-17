import React, { useState, useRef } from 'react';
import {
    Dialog,
    Typography,
    Box,
    CircularProgress,
    Button,
} from '@mui/material';
import { api } from '../../api/charlie';

export const NfcJsonReader = ({ children }) => {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [status, setStatus] = useState('');

    const pressTimer = useRef(null);

    const startScan = async () => {
        try {
            if (!('NDEFReader' in window)) {
                setStatus('Web NFC not supported on this device');
                setDialogOpen(true);
                return;
            }

            const ndef = new NDEFReader();
            setStatus('Scanning for NFC tag…');
            setDialogOpen(true);

            await ndef.scan();

            ndef.onreadingerror = () => {
                setStatus('Error reading NFC tag');
            };

            ndef.onreading = async (event) => {
                setStatus('NFC tag detected');

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
                    setStatus('Tag does not contain JSON');
                    return;
                }

                let parsed;
                try {
                    parsed = JSON.parse(jsonString);
                } catch {
                    setStatus('Invalid JSON in NFC tag');
                    return;
                }

                const { m, u, d } = parsed;

                if (!u) {
                    setStatus('JSON missing required fields: u for url');
                    return;
                }

                const method = m ?? 'GET';

                setStatus(
                    `Calling ${method} /api/${u} ${JSON.stringify(d ?? '')}`
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

                    setStatus('Request completed');

                    setTimeout(() => setDialogOpen(false), 2000);
                } catch (err) {
                    setStatus('Request failed: ' + err.message);
                }
            };
        } catch (err) {
            setStatus('NFC scan failed: ' + err.message);
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
