import React, { useState } from 'react';
import { Box, Button, IconButton, TextField, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MicIcon from '@mui/icons-material/Mic';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/**
 * Free-text field of the Shopping tab: the whole sentence is sent as a *raw
 * request*, exactly as a voice command would be, so it is the same background
 * job that structures it ("du lait, 2 baguettes et des pommes").
 *
 * Voice goes through the AI page: speech recognition runs server-side there
 * (`/ws/chat`), so there is no second capture pipeline to maintain.
 */
export const AddBar = ({ onAdd, disabled }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [text, setText] = useState('');

    const submit = async () => {
        const value = text.trim();
        if (!value) return;
        setText('');
        await onAdd(value);
    };

    return (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
                fullWidth
                size="small"
                value={text}
                placeholder={t('shopping.addPlaceholder')}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') submit();
                }}
                sx={{
                    '& .MuiOutlinedInput-root': {
                        borderRadius: 3,
                        bgcolor: 'rgba(10, 10, 11, 0.6)',
                    },
                }}
            />
            <Tooltip title={t('shopping.addByVoice')}>
                <IconButton
                    aria-label={t('shopping.addByVoice')}
                    onClick={() => navigate('/ai')}
                    sx={{ color: 'primary.main' }}
                >
                    <MicIcon fontSize="small" />
                </IconButton>
            </Tooltip>
            <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                disabled={disabled || !text.trim()}
                onClick={submit}
                aria-label={t('common.add')}
                sx={{ borderRadius: 3, whiteSpace: 'nowrap' }}
            >
                {/* Icon-only on a phone: the field needs the width. */}
                <Box
                    component="span"
                    sx={{ display: { xs: 'none', sm: 'inline' } }}
                >
                    {t('common.add')}
                </Box>
            </Button>
        </Box>
    );
};

export default AddBar;
