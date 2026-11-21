import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    IconButton,
    InputAdornment,
    Paper,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import LinkIcon from '@mui/icons-material/Link';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { api, apiStrict } from '../../api/charlie';
import { RecipeBody } from '../RecipeBody';

/** A pasted link or a search term: the field accepts both. */
const isUrl = (value) => /^https?:\/\//i.test((value ?? '').trim());

/** "4.7" â†’ "4,7" (the tab speaks French). */
const frenchNumber = (value) => String(value).replace('.', ',');

/**
 * Recettes tab.
 *
 * Search Marmiton (best-rated first), save a recipe to the household library,
 * read it, put its ingredients on the shopping list. The recipe itself is drawn
 * by `RecipeBody` â€” the same component the Scan tab uses, because a recipe read
 * from a photo and one imported from a page are the same shape.
 *
 * Nothing here decides policy: ranking, dedupe and the shopping merge live in
 * `skills/recipes/`, so the voice, the agent and this tab always agree.
 */
export const Recipes = () => {
    const { t } = useTranslation();
    /** A link from the Scan tab lands here with `?recipe=<id>`. */
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedRecipeId = searchParams.get('recipe');
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState('rating');
    const [candidates, setCandidates] = useState([]);
    const [searching, setSearching] = useState(false);
    const [library, setLibrary] = useState([]);
    const [selected, setSelected] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const loadLibrary = useCallback(async () => {
        const res = await api('recipes?limit=50');
        setLibrary(res?.recipes ?? []);
    }, []);

    useEffect(() => {
        loadLibrary().catch(() =>
            setError(t('recipes.loadFailed'))
        );
    }, [loadLibrary, t]);

    // Opened from a link (`/recipes?recipe=<id>`, e.g. from the Scan tab):
    // fetch it and show it, so the hand-off lands on the recipe itself.
    useEffect(() => {
        if (!requestedRecipeId) return undefined;

        let cancelled = false;
        api(`recipes/${requestedRecipeId}`).then((res) => {
            if (!cancelled && res?.recipe) setSelected(res.recipe);
        });
        return () => {
            cancelled = true;
        };
    }, [requestedRecipeId]);

    /** Closing the dialog drops the deep link too, so a reload does not reopen it. */
    const closeRecipe = useCallback(() => {
        setSelected(null);
        if (!requestedRecipeId) return;

        const next = new URLSearchParams(searchParams);
        next.delete('recipe');
        setSearchParams(next, { replace: true });
    }, [requestedRecipeId, searchParams, setSearchParams]);

    /** One import path for both a saved candidate and a pasted link. */
    const importFrom = useCallback(
        async (payload, candidateId) => {
            setBusy(true);
            setError('');
            setNotice('');
            try {
                const res = await apiStrict('recipes/import', {
                    method: 'POST',
                    body: JSON.stringify(payload),
                });
                const record = res?.recipe;
                if (!record) return;
                setNotice(
                    t('recipes.imported', { title: record.recipe?.title ?? '' })
                );
                if (candidateId) {
                    setCandidates((current) =>
                        current.map((candidate) =>
                            candidate.id === candidateId
                                ? { ...candidate, stored: true }
                                : candidate
                        )
                    );
                }
                await loadLibrary();
                setSelected(record);
            } catch (e) {
                setError(e?.message ?? t('recipes.importFailed'));
            } finally {
                setBusy(false);
            }
        },
        [loadLibrary, t]
    );

    const search = useCallback(async () => {
        const term = query.trim();
        if (!term) return;

        setError('');
        setNotice('');
        // A pasted URL is an import, not a search: no site vocabulary needed.
        if (isUrl(term)) {
            setCandidates([]);
            await importFrom({ url: term });
            return;
        }

        setSearching(true);
        try {
            const res = await api(
                `recipes/search?q=${encodeURIComponent(term)}&sort=${sort}`
            );
            if (res?.error) {
                setError(res.error);
                setCandidates([]);
            } else {
                setCandidates(res?.candidates ?? []);
            }
        } catch (e) {
            setError(e?.message ?? t('recipes.searchFailed'));
        } finally {
            setSearching(false);
        }
    }, [query, sort, importFrom, t]);

    const addToShopping = useCallback(
        async (id) => {
            setBusy(true);
            setError('');
            setNotice('');
            try {
                const res = await apiStrict(
                    `recipes/${id}/actions/add-to-shopping`,
                    { method: 'POST', body: JSON.stringify({}) }
                );
                if (res?.ok === false) {
                    setError(res.error ?? t('recipes.actionFailed'));
                    return;
                }
                setNotice(res?.message ?? t('recipes.shoppingAdded'));
            } catch (e) {
                setError(e?.message ?? t('recipes.actionFailed'));
            } finally {
                setBusy(false);
            }
        },
        [t]
    );

    const remove = useCallback(
        async (id) => {
            setBusy(true);
            try {
                await api(`recipes/${id}`, { method: 'DELETE' });
                if (selected?.id === id) setSelected(null);
                await loadLibrary();
            } finally {
                setBusy(false);
            }
        },
        [loadLibrary, selected]
    );

    return (
        <Stack spacing={2}>
            <Box>
                <Typography variant="h5">{t('recipes.title')}</Typography>
                <Typography variant="body2" color="text.secondary">
                    {t('recipes.subtitle')}
                </Typography>
            </Box>

            <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    alignItems={{ sm: 'center' }}
                >
                    <TextField
                        fullWidth
                        size="small"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') search();
                        }}
                        placeholder={t('recipes.searchPlaceholder')}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon fontSize="small" />
                                </InputAdornment>
                            ),
                        }}
                    />
                    <Button
                        variant="contained"
                        onClick={search}
                        disabled={searching || busy || !query.trim()}
                        sx={{ minWidth: 120 }}
                    >
                        {searching ? (
                            <CircularProgress size={18} color="inherit" />
                        ) : (
                            t('common.search')
                        )}
                    </Button>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <Chip
                        size="small"
                        label={t('recipes.sortRating')}
                        color={sort === 'rating' ? 'primary' : 'default'}
                        variant={sort === 'rating' ? 'filled' : 'outlined'}
                        onClick={() => setSort('rating')}
                    />
                    <Chip
                        size="small"
                        label={t('recipes.sortRelevance')}
                        color={sort === 'relevance' ? 'primary' : 'default'}
                        variant={sort === 'relevance' ? 'filled' : 'outlined'}
                        onClick={() => setSort('relevance')}
                    />
                </Stack>
            </Paper>

            {!!error && (
                <Alert severity="error" onClose={() => setError('')}>
                    {error}
                </Alert>
            )}
            {!!notice && (
                <Alert severity="success" onClose={() => setNotice('')}>
                    {notice}
                </Alert>
            )}
            {!!candidates.length && (
                <Box>
                    <Typography variant="subtitle1" gutterBottom>
                        {t('recipes.results')}
                    </Typography>
                    <Stack spacing={1}>
                        {candidates.map((candidate) => (
                            <Paper
                                key={candidate.id}
                                variant="outlined"
                                sx={{
                                    p: 1,
                                    display: 'flex',
                                    gap: 1.5,
                                    alignItems: 'center',
                                }}
                            >
                                {candidate.imageUrl && (
                                    <Box
                                        component="img"
                                        src={candidate.imageUrl}
                                        alt=""
                                        sx={{
                                            width: 72,
                                            height: 56,
                                            objectFit: 'cover',
                                            borderRadius: 1,
                                            flexShrink: 0,
                                            bgcolor: 'action.hover',
                                        }}
                                    />
                                )}
                                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                                    <Typography variant="subtitle2" noWrap>
                                        {candidate.title}
                                    </Typography>
                                    <Stack direction="row" spacing={1}>
                                        {candidate.category && (
                                            <Typography
                                                variant="caption"
                                                color="text.secondary"
                                                noWrap
                                            >
                                                {candidate.category}
                                            </Typography>
                                        )}
                                        {candidate.rating?.value > 0 && (
                                            <Typography
                                                variant="caption"
                                                color="warning.main"
                                                noWrap
                                            >
                                                {t('recipe.rated', {
                                                    value: frenchNumber(
                                                        candidate.rating.value
                                                    ),
                                                    count: candidate.rating
                                                        .count,
                                                })}
                                            </Typography>
                                        )}
                                    </Stack>
                                </Box>
                                <Tooltip
                                    title={
                                        candidate.stored
                                            ? t('recipes.saved')
                                            : t('recipes.save')
                                    }
                                >
                                    {/* A span keeps the tooltip alive on the disabled state. */}
                                    <span>
                                        <IconButton
                                            size="small"
                                            color="primary"
                                            aria-label={
                                                candidate.stored
                                                    ? t('recipes.saved')
                                                    : t('recipes.save')
                                            }
                                            disabled={busy || candidate.stored}
                                            onClick={() =>
                                                importFrom(
                                                    { url: candidate.url },
                                                    candidate.id
                                                )
                                            }
                                        >
                                            {candidate.stored ? (
                                                <CheckCircleIcon fontSize="small" />
                                            ) : (
                                                <AddIcon fontSize="small" />
                                            )}
                                        </IconButton>
                                    </span>
                                </Tooltip>
                            </Paper>
                        ))}
                    </Stack>
                </Box>
            )}

            <Divider />
            <Box>
                <Typography variant="subtitle1" gutterBottom>
                    {t('recipes.library')}
                </Typography>
                {!library.length ? (
                    <Alert severity="info" variant="outlined">
                        {t('recipes.libraryEmpty')}
                    </Alert>
                ) : (
                    <Stack spacing={1}>
                        {library.map((record) => (
                            <Paper
                                key={record.id}
                                variant="outlined"
                                sx={{
                                    p: 1,
                                    display: 'flex',
                                    gap: 1.5,
                                    alignItems: 'center',
                                }}
                            >
                                {record.imageUrl && (
                                    <Box
                                        component="img"
                                        src={record.imageUrl}
                                        alt=""
                                        sx={{
                                            width: 72,
                                            height: 56,
                                            objectFit: 'cover',
                                            borderRadius: 1,
                                            flexShrink: 0,
                                            bgcolor: 'action.hover',
                                        }}
                                    />
                                )}
                                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                                    <Typography variant="subtitle2" noWrap>
                                        {record.recipe?.title}
                                    </Typography>
                                    <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        noWrap
                                        sx={{ display: 'block' }}
                                    >
                                        {record.summary}
                                    </Typography>
                                </Box>
                                <Stack direction="row" spacing={0.5}>
                                    <Button
                                        size="small"
                                        onClick={() => setSelected(record)}
                                    >
                                        {t('recipes.open')}
                                    </Button>
                                    <Tooltip title={t('recipes.addToShopping')}>
                                        <IconButton
                                            size="small"
                                            disabled={busy}
                                            onClick={() =>
                                                addToShopping(record.id)
                                            }
                                        >
                                            <ShoppingCartIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title={t('common.delete')}>
                                        <IconButton
                                            size="small"
                                            color="error"
                                            disabled={busy}
                                            onClick={() => remove(record.id)}
                                        >
                                            <DeleteOutlineIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </Stack>
                            </Paper>
                        ))}
                    </Stack>
                )}
            </Box>
            <Dialog
                open={!!selected}
                onClose={closeRecipe}
                fullWidth
                maxWidth="md"
            >
                <DialogTitle>{selected?.recipe?.title ?? ''}</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2}>
                        {selected?.imageUrl && (
                            <Box
                                component="img"
                                src={selected.imageUrl}
                                alt=""
                                sx={{
                                    maxHeight: 260,
                                    width: '100%',
                                    objectFit: 'contain',
                                    bgcolor: 'action.hover',
                                    borderRadius: 2,
                                }}
                            />
                        )}
                        {selected?.recipe && (
                            <RecipeBody
                                recipe={selected.recipe}
                                rating={selected.rating}
                            />
                        )}
                        {selected?.description && (
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ whiteSpace: 'pre-wrap' }}
                            >
                                {selected.description}
                            </Typography>
                        )}
                        {selected?.sourceUrl && (
                            <Button
                                size="small"
                                startIcon={<LinkIcon />}
                                href={selected.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                            >
                                {t('recipes.source')}
                            </Button>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button
                        startIcon={<ShoppingCartIcon />}
                        disabled={busy || !selected?.id}
                        onClick={() => addToShopping(selected.id)}
                    >
                        {t('recipes.addToShopping')}
                    </Button>
                    <Button onClick={closeRecipe}>
                        {t('common.close')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Stack>
    );
};

export default Recipes;