import React, { useState } from 'react';
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Divider,
    Stack,
    Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * End-of-shopping actions: verify what was taken / left, then archive the list
 * ("Terminer"), or undo the whole basket.
 */
export const FinishBar = ({ list, onFinish, onUncheckAll, onClear, busy }) => {
    const { t } = useTranslation();
    const [confirm, setConfirm] = useState(false);

    const taken = list?.taken ?? 0;
    const todo = list?.todo ?? 0;
    const hasItems = (list?.items?.length ?? 0) > 0;

    return (
        <>
            <Divider sx={{ my: 2 }} />
            <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                flexWrap="wrap"
            >
                <Typography variant="body2" color="text.secondary">
                    {t('shopping.counts', { todo, taken })}
                </Typography>
                {hasItems && taken === 0 && (
                    <Typography variant="caption" color="text.secondary">
                        {t('shopping.finishNeedTaken')}
                    </Typography>
                )}
                <Stack
                    direction="row"
                    spacing={1}
                    sx={{ ml: 'auto', width: { xs: '100%', sm: 'auto' } }}
                    flexWrap="wrap"
                    useFlexGap
                >
                    {taken > 0 && (
                        <Button
                            size="small"
                            disabled={busy}
                            onClick={onUncheckAll}
                        >
                            {t('shopping.uncheckAll')}
                        </Button>
                    )}
                    {hasItems && (
                        <Button size="small" disabled={busy} onClick={onClear}>
                            {t('shopping.clear')}
                        </Button>
                    )}
                    <Button
                        variant="contained"
                        size="small"
                        disabled={busy || taken === 0}
                        onClick={() => setConfirm(true)}
                        sx={{ width: { xs: '100%', sm: 'auto' } }}
                    >
                        {t('shopping.finish')}
                    </Button>
                </Stack>
            </Stack>

            <Dialog
                open={confirm}
                onClose={() => setConfirm(false)}
                fullWidth
                maxWidth="xs"
            >
                <DialogTitle>{t('shopping.finishTitle')}</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {t('shopping.finishConfirm', { taken, todo })}
                    </DialogContentText>
                    {todo > 0 && (
                        <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', mt: 1 }}
                        >
                            {t('shopping.finishKeep', { todo })}
                        </Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirm(false)}>
                        {t('common.cancel')}
                    </Button>
                    <Button
                        variant="contained"
                        disabled={busy}
                        onClick={async () => {
                            setConfirm(false);
                            await onFinish();
                        }}
                    >
                        {t('shopping.finishArchive')}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default FinishBar;
