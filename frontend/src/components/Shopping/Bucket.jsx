import React, { useEffect, useState } from 'react';
import {
    Box,
    Collapse,
    IconButton,
    Stack,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import UndoIcon from '@mui/icons-material/Undo';
import { useTranslation } from 'react-i18next';
import { basketPeek, formatQuantity } from './utils';

/** Where this device remembers whether the basket section is open. */
const OPEN_KEY = 'charlie.shopping.basketOpen';

function storedOpen() {
    try {
        const raw = window.localStorage.getItem(OPEN_KEY);
        return raw === null ? undefined : raw === 'true';
    } catch {
        // Storage disabled (private mode): fall back to the device default.
        return undefined;
    }
}

function storeOpen(open) {
    try {
        window.localStorage.setItem(OPEN_KEY, String(open));
    } catch {
        // Storage disabled: nothing to remember.
    }
}

/**
 * The basket: what has been taken.
 *
 * One row per line, sized for a thumb: tapping the row puts it back on the list
 * (the ↩ does the same explicitly, the bin removes it for good). The header
 * stays visible while the list scrolls and peeks at its content when collapsed;
 * a phone opens it collapsed by default and remembers the choice.
 */
export const Bucket = ({ items, onUntake, onRemove, busy }) => {
    const { t } = useTranslation();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const [open, setOpen] = useState(() => storedOpen() ?? !isMobile);

    useEffect(() => {
        storeOpen(open);
    }, [open]);

    const count = items?.length ?? 0;

    return (
        <Box
            sx={{
                mt: 1.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 3,
            }}
        >
            <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                onClick={() => setOpen((v) => !v)}
                sx={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                    bgcolor: 'background.paper',
                    px: 1.5,
                    py: 0.5,
                    minHeight: 48,
                    borderTopLeftRadius: 12,
                    borderTopRightRadius: 12,
                    cursor: 'pointer',
                }}
            >
                <CheckCircleIcon
                    fontSize="small"
                    sx={{ color: count ? 'success.main' : 'text.disabled' }}
                />
                <Typography variant="subtitle2" sx={{ flexShrink: 0 }}>
                    {t('shopping.basket', { n: count })}
                </Typography>
                {!open && count > 0 && (
                    <Typography
                        variant="caption"
                        noWrap
                        sx={{ color: 'text.secondary', minWidth: 0 }}
                    >
                        {basketPeek(items)}
                    </Typography>
                )}
                <ExpandMoreIcon
                    fontSize="small"
                    sx={{
                        ml: 'auto',
                        flexShrink: 0,
                        transition: 'transform 150ms',
                        transform: open ? 'rotate(180deg)' : 'none',
                    }}
                />
            </Stack>

            <Collapse in={open}>
                {count === 0 ? (
                    <Typography
                        variant="body2"
                        sx={{ color: 'text.secondary', px: 1.5, py: 1.5 }}
                    >
                        {t('shopping.basketEmpty')}
                    </Typography>
                ) : (
                    <Box sx={{ px: 0.5, pb: 0.5 }}>
                        {items.map((item) => (
                            <Stack
                                key={item.id}
                                direction="row"
                                alignItems="center"
                                spacing={0.5}
                                onClick={() => !busy && onUntake(item)}
                                sx={{
                                    px: 0.5,
                                    minHeight: 48,
                                    borderRadius: 2,
                                    cursor: 'pointer',
                                    '&:hover': { bgcolor: 'action.hover' },
                                }}
                            >
                                <CheckCircleIcon
                                    fontSize="small"
                                    sx={{
                                        color: 'success.main',
                                        ml: 0.5,
                                        flexShrink: 0,
                                    }}
                                />
                                <Typography
                                    variant="body2"
                                    noWrap
                                    sx={{
                                        flexGrow: 1,
                                        minWidth: 0,
                                        color: 'text.secondary',
                                    }}
                                >
                                    {item.name}
                                </Typography>
                                {formatQuantity(item) && (
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            color: 'text.secondary',
                                            flexShrink: 0,
                                        }}
                                    >
                                        {formatQuantity(item)}
                                    </Typography>
                                )}
                                <Tooltip title={t('shopping.cancelTaken')}>
                                    <IconButton
                                        size="small"
                                        disabled={busy}
                                        aria-label={t('shopping.cancelTaken')}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onUntake(item);
                                        }}
                                        sx={{ p: 1.5, flexShrink: 0 }}
                                    >
                                        <UndoIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                                {onRemove && (
                                    <Tooltip
                                        title={t('shopping.removeFromBasket')}
                                    >
                                        <IconButton
                                            size="small"
                                            disabled={busy}
                                            aria-label={t(
                                                'shopping.removeFromBasket'
                                            )}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRemove(item);
                                            }}
                                            sx={{ p: 1.5, flexShrink: 0 }}
                                        >
                                            <DeleteOutlineIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                )}
                            </Stack>
                        ))}
                    </Box>
                )}
            </Collapse>
        </Box>
    );
};

export default Bucket;
