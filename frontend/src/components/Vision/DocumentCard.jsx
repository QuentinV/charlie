import React from 'react';
import {
    Box,
    Chip,
    CircularProgress,
    ListItemButton,
    Stack,
    Typography,
} from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useTranslation } from 'react-i18next';
import { formatWhen, typeLabel, useScanImage } from './utils';

/** One row of the scan history: thumbnail, type, summary and state. */
export const DocumentCard = ({ scan, modules, lang, selected, onSelect }) => {
    const { t } = useTranslation();
    const thumb = useScanImage(scan.imageUrl);

    return (
        <ListItemButton
            selected={selected}
            onClick={() => onSelect(scan)}
            sx={{ gap: 1.5, alignItems: 'flex-start', borderRadius: 2 }}
        >
            <Box
                sx={{
                    width: 44,
                    height: 56,
                    flexShrink: 0,
                    borderRadius: 1,
                    overflow: 'hidden',
                    bgcolor: 'action.hover',
                }}
            >
                {thumb && (
                    <Box
                        component="img"
                        src={thumb}
                        alt=""
                        sx={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                        }}
                    />
                )}
            </Box>

            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                    {scan.type && (
                        <Chip
                            size="small"
                            label={typeLabel(modules, scan.type)}
                        />
                    )}
                    {scan.status === 'pending' && (
                        <CircularProgress size={12} />
                    )}
                    {scan.status === 'failed' && (
                        <ErrorOutlineIcon fontSize="small" color="error" />
                    )}
                    <Typography variant="caption" color="text.secondary">
                        {formatWhen(scan.createdAt, lang)}
                    </Typography>
                </Stack>

                <Typography
                    variant="body2"
                    sx={{
                        mt: 0.5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                    }}
                >
                    {scan.summary ??
                        (scan.status === 'pending'
                            ? t('vision.reading')
                            : (scan.error ?? ''))}
                </Typography>
            </Box>
        </ListItemButton>
    );
};

export default DocumentCard;
