import React from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Divider,
    Stack,
    Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { TypePicker } from './TypePicker';
import { RecipeBody } from '../RecipeBody';
import { formatWhen, typeLabel, useScanImage } from './utils';

/**
 * Detail of one scan: the image, its state, the data read from it and what can
 * be done with it (act, re-read, change the type, delete).
 *
 * Nothing here knows a document type beyond rendering `data`: the action buttons
 * come from the module catalogue the API returns, so a new type shows up here
 * without touching this file. The one exception is deliberate and visible: a
 * recipe the household already filed in its library (`savedRecipe`) is offered
 * as a link to it rather than as a button that would file it again.
 */
export const DocumentView = ({
    scan,
    savedRecipe,
    modules,
    lang,
    busy,
    onRescan,
    onAction,
    onDelete,
}) => {
    const { t } = useTranslation();
    const image = useScanImage(scan?.imageUrl);
    const module = modules?.find((m) => m.id === scan?.type);

    if (!scan) return null;

    return (
        <Stack spacing={2}>
            {image && (
                <Box
                    component="img"
                    src={image}
                    alt=""
                    sx={{
                        maxHeight: 280,
                        width: '100%',
                        objectFit: 'contain',
                        bgcolor: 'action.hover',
                        borderRadius: 2,
                    }}
                />
            )}

            <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
            >
                {scan.type && (
                    <Chip label={typeLabel(modules, scan.type)} size="small" />
                )}
                {scan.typeSource === 'forced' && (
                    <Chip
                        label={t('vision.typeForced')}
                        size="small"
                        variant="outlined"
                    />
                )}
                <Typography variant="caption" color="text.secondary">
                    {formatWhen(scan.createdAt, lang)}
                </Typography>
            </Stack>

            {scan.status === 'pending' && (
                <Alert icon={<CircularProgress size={18} />} severity="info">
                    {t('vision.readingHint')}
                </Alert>
            )}

            {scan.status === 'failed' && (
                <Alert
                    severity="error"
                    action={
                        <Button
                            size="small"
                            startIcon={<RefreshIcon />}
                            disabled={busy}
                            onClick={() => onRescan()}
                        >
                            {t('common.retry')}
                        </Button>
                    }
                >
                    {scan.error ?? t('vision.readFailed')}
                </Alert>
            )}

            {scan.status === 'done' && (
                <>
                    {scan.data?.title && (
                        <Typography variant="h6">{scan.data.title}</Typography>
                    )}
                    {scan.data?.description && (
                        <Typography
                            variant="body2"
                            sx={{ whiteSpace: 'pre-wrap' }}
                        >
                            {scan.data.description}
                        </Typography>
                    )}
                    {scan.type === 'recipe' && scan.data && (
                        <RecipeBody recipe={scan.data} />
                    )}
                </>
            )}

            <Divider />

            <Box>
                <Typography variant="subtitle2" gutterBottom>
                    {t('vision.typeTitle')}
                </Typography>
                <TypePicker
                    modules={modules}
                    value={scan.typeSource === 'forced' ? scan.type : ''}
                    disabled={busy}
                    onChange={(type) => onRescan(type || undefined)}
                />
            </Box>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {savedRecipe ? (
                    /**
                     * Already in the household library: the button that filed it
                     * becomes a link to the recipe itself — which is where its
                     * ingredients go to the shopping list, one place for that
                     * gesture whatever the source of the recipe.
                     */
                    <Button
                        variant="contained"
                        size="small"
                        component={RouterLink}
                        to={`/recipes?recipe=${savedRecipe.id}`}
                        startIcon={<MenuBookIcon />}
                    >
                        {t('vision.seeRecipe')}
                    </Button>
                ) : (
                    (module?.actions ?? []).map((action) => (
                        <Button
                            key={action.id}
                            variant="contained"
                            size="small"
                            disabled={busy || scan.status !== 'done'}
                            onClick={() => onAction(action.id)}
                        >
                            {action.label}
                        </Button>
                    ))
                )}
                <Button
                    size="small"
                    startIcon={<RefreshIcon />}
                    disabled={busy || scan.status === 'pending'}
                    onClick={() =>
                        onRescan(
                            scan.typeSource === 'forced' ? scan.type : undefined
                        )
                    }
                >
                    {t('vision.rescan')}
                </Button>
                <Button
                    size="small"
                    color="error"
                    startIcon={<DeleteOutlineIcon />}
                    disabled={busy}
                    onClick={() => onDelete()}
                >
                    {t('common.delete')}
                </Button>
            </Stack>

            {scan.status === 'done' && scan.timingMs && (
                <Typography variant="caption" color="text.secondary">
                    {t('vision.timings', {
                        detect: Math.round((scan.timingMs.detect ?? 0) / 1000),
                        extract: Math.round(
                            (scan.timingMs.extract ?? 0) / 1000
                        ),
                        kb: Math.round((scan.image?.bytes ?? 0) / 1024),
                    })}
                </Typography>
            )}
        </Stack>
    );
};

export default DocumentView;

