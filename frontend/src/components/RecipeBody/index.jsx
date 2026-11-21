import React from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

/** Seconds → "45 s" / "12 min" / "1 h 30". */
const formatDuration = (seconds) => {
    if (!seconds) return '';
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest}` : `${hours} h`;
};

/** "4.7" → "4,7" (French decimal, as the voice says it). */
const frenchNumber = (value) => String(value).replace('.', ',');

/**
 * Ingredients, steps, yield, times — and the rating when the source has one.
 *
 * One renderer for the two sources on purpose: a recipe read from a photo
 * (`vision/modules/recipe.ts`) and a page imported from Marmiton (`recipes`
 * collection) are the same `Recipe` (`types.ts`), so the Scan tab and the
 * Recettes tab must not draw them twice — and a change to one is a change to
 * both.
 */
export const RecipeBody = ({ recipe, rating }) => {
    const { t } = useTranslation();
    const yields = recipe?.estimatedFor;

    return (
        <Stack spacing={2}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {yields?.persons > 0 && (
                    <Chip
                        size="small"
                        variant="outlined"
                        label={t('recipe.serves', { people: yields.persons })}
                    />
                )}
                {yields?.quantity > 0 && yields?.name && (
                    <Chip
                        size="small"
                        variant="outlined"
                        label={t('recipe.yields', {
                            amount: yields.quantity,
                            name: yields.name,
                        })}
                    />
                )}
                {recipe?.prepTimeS > 0 && (
                    <Chip
                        size="small"
                        variant="outlined"
                        label={t('recipe.prepTime', {
                            time: formatDuration(recipe.prepTimeS),
                        })}
                    />
                )}
                {recipe?.cookTimeS > 0 && (
                    <Chip
                        size="small"
                        variant="outlined"
                        label={t('recipe.cookTime', {
                            time: formatDuration(recipe.cookTimeS),
                        })}
                    />
                )}
                {rating?.value > 0 && (
                    <Chip
                        size="small"
                        color="primary"
                        variant="outlined"
                        label={t('recipe.rated', {
                            value: frenchNumber(rating.value),
                            count: rating.count,
                        })}
                    />
                )}
            </Stack>

            <Box>
                <Typography variant="subtitle2" gutterBottom>
                    {t('recipe.ingredients')}
                </Typography>
                <Stack spacing={0.5}>
                    {(recipe?.ingredients ?? []).map((ingredient, i) => (
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

            {!!recipe?.steps?.length && (
                <Box>
                    <Typography variant="subtitle2" gutterBottom>
                        {t('recipe.steps')}
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

export default RecipeBody;