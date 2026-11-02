import React, { useEffect, useState } from 'react';
import {
    Box,
    Chip,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    Stack,
    Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/charlie';
import { formatQuantity } from './utils';

/**
 * Archived lists ("terminer les courses"): what was actually taken, when. The
 * history is read-only — a new list starts on the next added item.
 */
export const History = ({ open, onClose }) => {
    const { t } = useTranslation();
    const [lists, setLists] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        api('shopping/history?limit=10')
            .then((res) => {
                if (!cancelled) setLists(res?.lists ?? []);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open]);

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>{t('shopping.history')}</DialogTitle>
            <DialogContent>
                {loading && <CircularProgress size={20} />}
                {!loading && !lists.length && (
                    <Typography variant="body2" color="text.secondary">
                        {t('shopping.historyEmpty')}
                    </Typography>
                )}
                {lists.map((list) => (
                    <Box key={list._id} sx={{ mb: 2 }}>
                        <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            mb={0.5}
                        >
                            <Typography variant="subtitle2">
                                {new Date(
                                    list.archivedAt
                                ).toLocaleDateString()}
                            </Typography>
                            <Typography
                                variant="caption"
                                color="text.secondary"
                            >
                                {t('shopping.historyCounts', {
                                    total: list.total,
                                })}
                            </Typography>
                        </Stack>
                        <Box
                            sx={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 0.5,
                            }}
                        >
                            {(list.items ?? []).map((item) => (
                                <Chip
                                    key={item.id}
                                    size="small"
                                    variant="outlined"
                                    color={
                                        item.status === 'taken'
                                            ? 'success'
                                            : 'default'
                                    }
                                    label={
                                        formatQuantity(item)
                                            ? `${item.name} (${formatQuantity(
                                                  item
                                              )})`
                                            : item.name
                                    }
                                />
                            ))}
                        </Box>
                        <Divider sx={{ mt: 1.5 }} />
                    </Box>
                ))}
            </DialogContent>
        </Dialog>
    );
};

export default History;
