import React, { useRef, useState } from 'react';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/charlie';

/**
 * Photo picker of the Scan tab: the phone camera (`capture`), a file, or a drag
 * & drop.
 *
 * The bytes are posted raw — the server mounts a parser sized for a photo (the
 * default 100 kB JSON parser would reject it) — and the answer comes back as a
 * `pending` scan: the reading itself takes minutes on CPU and happens in the
 * background, which is what the tab polls.
 */
export const ScanDrop = ({ type, disabled, onScan, onError }) => {
    const { t } = useTranslation();
    const inputRef = useRef(null);
    const [busy, setBusy] = useState(false);
    const [over, setOver] = useState(false);

    const send = async (file) => {
        if (!file) return;
        setBusy(true);
        try {
            const query = `vision/scans?source=ui${
                type ? `&type=${encodeURIComponent(type)}` : ''
            }`;
            const res = await api(query, {
                method: 'POST',
                headers: { 'Content-Type': file.type || 'image/jpeg' },
                body: file,
            });
            if (!res?.scan) {
                onError(res?.message ?? t('vision.uploadFailed'));
                return;
            }
            onScan(res.scan);
        } catch (e) {
            onError(e?.message ?? String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box
            onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                send(e.dataTransfer?.files?.[0]);
            }}
            sx={{
                border: '1px dashed',
                borderColor: over ? 'primary.main' : 'divider',
                borderRadius: 2,
                p: 2,
                textAlign: 'center',
            }}
        >
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    send(file);
                }}
            />
            <Stack
                direction="row"
                spacing={1}
                justifyContent="center"
                alignItems="center"
            >
                <Button
                    variant="contained"
                    startIcon={
                        busy ? (
                            <CircularProgress size={16} color="inherit" />
                        ) : (
                            <PhotoCameraIcon />
                        )
                    }
                    disabled={disabled || busy}
                    onClick={() => inputRef.current?.click()}
                >
                    {t('vision.takePhoto')}
                </Button>
            </Stack>
            <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 1 }}
            >
                {t('vision.dropHint')}
            </Typography>
        </Box>
    );
};

export default ScanDrop;
