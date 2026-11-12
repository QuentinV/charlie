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
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import { TypePicker } from './TypePicker';
import { formatDuration, formatWhen, typeLabel, useScanImage } from './utils';

/** Ingredients and steps of a recipe (shape: `vision/modules/recipe.ts`). */
const RecipeBody = ({ recipe }) => {
    const { t } = useTranslation();
    const yields = recipe.estimatedFor;

    return (
        <Stack spacing={2}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {yields?.persons > 0 && (
                    <Chip
                        size="small"
                        variant="outlined"
                        label={t('vision.serves', { people: yields.persons })}
                    />
                )}
                {yields?.quantity > 0 && yields?.name && (
                    <Chip
                        size="small"
                        variant="outlined"
                        label={t('vision.yields', {
                            amount: yields.quantity,
                            name: yields.name,
                        })}
                    />
                )}
                {recipe.prepTimeS > 0 && (
                    <Chip
                        size="small"
                        variant="outlined"
                        label={t('vision.prepTime', {
                            time: formatDuration(recipe.prepTimeS),
                        })}
                    />
                )}
                {recipe.cookTimeS > 0 && (
                    <Chip
                        size="small"
                        variant="outlined"
                        label={t('vision.cookTime', {
                            time: formatDuration(recipe.cookTimeS),
                        })}
                    />
                )}
            </Stack>

            <Box>
                <Typography variant="subtitle2" gutterBottom>
                    {t('vision.ingredients')}
                </Typography>
                <Stack spacing={0.5}>
                    {(recipe.ingredients ?? []).map((ingredient, i) => (
                        <Stack
                            key={`${ingredient.name}-${i}`}
                            direction="row"
                            spacing={1}
                        >
                            <Typography
                                variant="body2"
                                sx={{ minWidth: 72, fontWeight: 600 }}
                            >
                                {ingredient.quantity
                                    ? `${ingredient.quantity}${
                                          ingredient.unit
                                              ? ` ${ingredient.unit}`
                                              : ''
                                      }`
                                    : ''}
                            </Typography>
                            <Typography variant="body2">
                                {ingredient.name}
                                {ingredient.note ? ` (${ingredient.note})` : ''}
                            </Typography>
                        </Stack>
                    ))}
                </Stack>
            </Box>

            {!!recipe.steps?.length && (
                <Box>
                    <Typography variant="subtitle2" gutterBottom>
                        {t('vision.steps')}
                    </Typography>
                    <Stack spacing={1}>
                        {recipe.steps.map((step, i) => (
                            <Stack key={i} direction="row" spacing={1}>
                                <Typography
                                    variant="body2"
                                    color="text.secondary"
                                    sx={{ minWidth: 18 }}
                                >
                                    {i + 1}.
                                </Typography>
                                <Typography variant="body2">{step}</Typography>
                            </Stack>
                        ))}
                    </Stack>
                </Box>
            )}
        </Stack>
    );
};

/**
 * Detail of one scan: the image, its state, the data read from it and what can
 * be done with it (act, re-read, change the type, delete).
 *
 * Nothing here knows a document type beyond rendering `data`: the action buttons
 * come from the module catalogue the API returns, so a new type shows up here
 * without touching this file.
 */
export const DocumentView = ({
    scan,
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
                {(module?.actions ?? []).map((action) => (
                    <Button
                        key={action.id}
                        variant="contained"
                        size="small"
                        disabled={busy || scan.status !== 'done'}
                        onClick={() => onAction(action.id)}
                    >
                        {action.label}
                    </Button>
                ))}
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

