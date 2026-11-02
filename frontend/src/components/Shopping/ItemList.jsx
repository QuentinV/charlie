import React from 'react';
import {
    Box,
    Checkbox,
    Chip,
    IconButton,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import { formatQuantity, groupItems } from './utils';

/**
 * Items still to buy, grouped by aisle. The checkbox is the main gesture of the
 * tab: it moves the item to the basket, where it can still be cancelled.
 */
export const ItemList = ({ items, onTake, onEdit, onRemove, busy }) => {
    const { t } = useTranslation();

    if (!items?.length) {
        return (
            <Typography
                variant="body2"
                color="text.secondary"
                sx={{ py: 3, textAlign: 'center' }}
            >
                {t('shopping.emptyActive')}
            </Typography>
        );
    }

    return (
        <Box>
            {groupItems(items).map((group) => (
                <Box key={group.category} sx={{ mb: 1.5 }}>
                    <Typography
                        variant="overline"
                        sx={{ color: 'text.secondary', letterSpacing: '0.08em' }}
                    >
                        {t(`shopping.category.${group.category}`, {
                            defaultValue: group.category,
                        })}
                    </Typography>
                    {group.items.map((item) => (
                        <Stack
                            key={item.id}
                            direction="row"
                            alignItems="center"
                            spacing={0.5}
                            onClick={() => !busy && onTake(item)}
                            sx={{
                                px: 0.5,
                                minHeight: 48,
                                borderRadius: 2,
                                cursor: 'pointer',
                                '&:hover': { bgcolor: 'action.hover' },
                            }}
                        >
                            <Checkbox
                                size="small"
                                checked={false}
                                disabled={busy}
                                onChange={() => onTake(item)}
                                onClick={(e) => e.stopPropagation()}
                                inputProps={{
                                    'aria-label': t('shopping.markTaken', {
                                        name: item.name,
                                    }),
                                }}
                            />
                            <Typography
                                variant="body2"
                                noWrap
                                sx={{ flexGrow: 1, minWidth: 0 }}
                            >
                                {item.name}
                            </Typography>
                            {formatQuantity(item) && (
                                <Chip
                                    size="small"
                                    variant="outlined"
                                    label={formatQuantity(item)}
                                    sx={{
                                        height: 20,
                                        fontSize: '0.7rem',
                                        flexShrink: 0,
                                    }}
                                />
                            )}
                            {item.user && (
                                <Typography
                                    variant="caption"
                                    sx={{
                                        color: 'text.secondary',
                                        flexShrink: 0,
                                        display: { xs: 'none', sm: 'block' },
                                    }}
                                >
                                    {item.user}
                                </Typography>
                            )}
                            <Tooltip title={t('common.edit')}>
                                <IconButton
                                    size="small"
                                    disabled={busy}
                                    onClick={() => onEdit(item)}
                                    sx={{ p: 1.5, flexShrink: 0 }}
                                >
                                    <EditIcon fontSize="inherit" />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title={t('common.delete')}>
                                <IconButton
                                    size="small"
                                    disabled={busy}
                                    onClick={() => onRemove(item)}
                                    sx={{ p: 1.5, flexShrink: 0 }}
                                >
                                    <DeleteOutlineIcon fontSize="inherit" />
                                </IconButton>
                            </Tooltip>
                        </Stack>
                    ))}
                </Box>
            ))}
        </Box>
    );
};

export default ItemList;
