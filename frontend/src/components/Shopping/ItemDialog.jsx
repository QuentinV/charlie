import React, { useEffect, useState } from 'react';
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Stack,
    TextField,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * Manual correction of one line (name, quantity, unit): the restructurer can be
 * wrong on a mangled name, and the user is standing in the aisle.
 */
export const ItemDialog = ({ item, open, busy, onClose, onSave }) => {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [quantity, setQuantity] = useState('');
    const [unit, setUnit] = useState('');
    const [note, setNote] = useState('');

    useEffect(() => {
        if (!open || !item) return;
        setName(item.name ?? '');
        setQuantity(
            item.quantity === undefined || item.quantity === null
                ? ''
                : String(item.quantity)
        );
        setUnit(item.unit ?? '');
        setNote(item.note ?? '');
    }, [open, item]);

    const save = async () => {
        if (!name.trim()) return;
        await onSave(item.id, {
            name: name.trim(),
            quantity: quantity.trim() === '' ? null : quantity.trim(),
            unit: unit.trim(),
            note: note.trim(),
        });
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
            <DialogTitle>{t('shopping.editItem')}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ pt: 1 }}>
                    <TextField
                        autoFocus
                        fullWidth
                        size="small"
                        label={t('common.name')}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                    <Stack direction="row" spacing={1}>
                        <TextField
                            size="small"
                            sx={{ width: 120 }}
                            label={t('shopping.quantity')}
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                        />
                        <TextField
                            size="small"
                            sx={{ flexGrow: 1 }}
                            label={t('shopping.unit')}
                            value={unit}
                            onChange={(e) => setUnit(e.target.value)}
                        />
                    </Stack>
                    <TextField
                        fullWidth
                        size="small"
                        label={t('shopping.note')}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                    />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t('common.cancel')}</Button>
                <Button
                    variant="contained"
                    disabled={busy || !name.trim()}
                    onClick={save}
                >
                    {t('common.save')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ItemDialog;
