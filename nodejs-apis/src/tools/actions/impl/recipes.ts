/**
 * Tier-1 recipe actions (no LLM): look a recipe up, and put a saved recipe's
 * ingredients on the shopping list.
 *
 * A voice search **never saves**: it announces the best-rated candidates and the
 * household decides (Recettes tab, or by asking the agent to save one). Saving
 * silently would turn "qu'est-ce que je pourrais cuisiner ?" into a library
 * nobody curates.
 */
import { Tools } from '../../../types';
import {
    addRecipeToShopping,
    findRecipeByTitle,
    searchRecipes,
    spokenRecipeQuery,
} from '../../../skills/recipes';
import { t } from '../langs';

interface RecipeRequest {
    freeText?: string;
    slots?: { text?: string };
    user?: string;
}

/** "cherche une recette de poulet basquaise" → "poulet basquaise". */
function queryOf(req: RecipeRequest): string {
    return spokenRecipeQuery(req?.slots?.text ?? req?.freeText ?? '');
}

/** Number of candidates the voice reads (short and comparable). */
const SPOKEN_CANDIDATES = 3;

export const tools: Tools = {
    searchRecipe: {
        exec: async (req: RecipeRequest) => {
            const query = queryOf(req);
            if (!query) return false;

            try {
                const candidates = await searchRecipes(query, {
                    limit: SPOKEN_CANDIDATES,
                });
                if (!candidates.length) return t('recipes.none', { query });

                const best = candidates[0];
                return t('recipes.found', {
                    count: candidates.length,
                    title: best.title,
                    rating: best.rating
                        ? t('recipes.rating', {
                              value: String(best.rating.value).replace(
                                  '.',
                                  ','
                              ),
                              count: best.rating.count,
                          })
                        : '',
                });
            } catch {
                // The site being unreachable is not a failed command: say it.
                return t('recipes.unreachable');
            }
        },
    },
    addRecipeIngredients: {
        exec: async (req: RecipeRequest) => {
            const query = queryOf(req);
            if (!query) return false;

            const record = await findRecipeByTitle(query);
            if (!record) return t('recipes.unknown', { query });

            const result = await addRecipeToShopping(record._id, req?.user);
            return result.ok ? t('recipes.added') : t('recipes.failed');
        },
    },
};

export default tools;