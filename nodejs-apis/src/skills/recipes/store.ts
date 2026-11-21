/**
 * Persistence of the household's cooking library (collection `recipes`).
 *
 * Deliberately dumb, like `skills/shopping/list.ts`: the skill's `index.ts`
 * decides what a record means, this only reads and writes it.
 *
 * `sourceKey` is the identity: importing the same page twice **updates** the
 * record in place (`marmiton:16969`), so a library never grows duplicates. The
 * folded title/ingredients are written here, at save time, so a search is a
 * string match instead of a scan of every recipe.
 */
import { v4 as uuid } from 'uuid';
import { cs } from '../../core/db';
import { RecipeRecord, RecipeSource } from '../../types';
import { foldName } from '../shopping/items.logic';

const MAX_PAGE = 200;

/** Identity of a stored recipe, by source (`marmiton:16969`, `scan:<id>`). */
export function recipeSourceKey(source: RecipeSource, id: string): string {
    return `${source}:${id}`;
}

/** What a caller provides; the store owns the id, the folds and the stamps. */
export type RecipeRecordInput = Omit<
    RecipeRecord,
    '_id' | 'titleFold' | 'ingredientsFold' | 'createdAt' | 'updatedAt'
> & { createdAt?: number };

function folds(record: RecipeRecord): Pick<
    RecipeRecord,
    'titleFold' | 'ingredientsFold'
> {
    return {
        titleFold: foldName(record.recipe.title),
        ingredientsFold: foldName(
            (record.recipe.ingredients ?? []).map((i) => i.name).join(' ')
        ),
    };
}

/** Create or refresh the record of one source. Returns the stored document. */
export async function upsertRecipe(
    input: RecipeRecordInput
): Promise<RecipeRecord> {
    const existing = await cs.recipes.findOne({ sourceKey: input.sourceKey });
    const now = Date.now();

    const record: RecipeRecord = {
        ...input,
        _id: existing?._id ?? uuid(),
        ...folds(input as RecipeRecord),
        createdAt: existing?.createdAt ?? input.createdAt ?? now,
        updatedAt: now,
    };

    // Never `$set` `_id`: Mongo refuses to modify it.
    const { _id, ...fields } = record;
    await cs.recipes.updateOne({ _id }, { $set: fields }, { upsert: true });
    return record;
}

export async function getRecipe(id: string): Promise<RecipeRecord | undefined> {
    return (await cs.recipes.findOne({ _id: id })) ?? undefined;
}

export async function findBySourceKey(
    sourceKey: string
): Promise<RecipeRecord | undefined> {
    return (await cs.recipes.findOne({ sourceKey })) ?? undefined;
}

/**
 * The library, newest first, optionally filtered on a folded needle or on the
 * scan it was read from.
 *
 * The filter is applied in memory over the last `MAX_PAGE` recipes: a household
 * library is small, and `foldName` is what makes "crêpes" find "Crepes" — the
 * same folding the shopping list uses, never a Mongo regex.
 */
export async function listRecipes(
    query: { query?: string; limit?: number; scanId?: string } = {}
): Promise<RecipeRecord[]> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), MAX_PAGE);
    const needle = foldName(query.query);

    // `scanId` is the Scan tab asking "did I already file this document?".
    const filter: { [key: string]: string } = {};
    if (query.scanId) filter.scanId = query.scanId;

    const docs: RecipeRecord[] = await cs.recipes
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(needle ? MAX_PAGE : limit)
        .toArray();

    if (!needle) return docs;

    return docs
        .filter(
            (doc) =>
                (doc.titleFold ?? '').includes(needle) ||
                (doc.ingredientsFold ?? '').includes(needle)
        )
        .slice(0, limit);
}

/**
 * The library record a scan produced, if the household kept it.
 *
 * This is what tells the Scan tab "already in my recipes" and gives it a link,
 * without the scan record mirroring the library: the collection stays the only
 * source of truth, so deleting a recipe makes the link disappear.
 */
export async function findRecipeByScanId(
    scanId: string
): Promise<RecipeRecord | undefined> {
    if (!scanId) return undefined;
    return (await cs.recipes.findOne({ scanId })) ?? undefined;
}

/** The stored recipes among these source keys (the search marks them). */
export async function savedSourceKeys(keys: string[]): Promise<string[]> {
    if (!keys?.length) return [];
    const docs = await cs.recipes
        .find({ sourceKey: { $in: keys } }, { projection: { sourceKey: 1 } })
        .toArray();
    return docs.map((d: RecipeRecord) => d.sourceKey);
}

/**
 * The best match of a spoken recipe name: exact fold first, then a prefix, then
 * a substring — the shortest title wins, so "poulet basquaise" prefers the
 * recipe actually called that over "Poulet basquaise au Cookeo".
 */
export async function findRecipeByTitle(
    title: string
): Promise<RecipeRecord | undefined> {
    const needle = foldName(title);
    if (!needle) return undefined;

    const docs: RecipeRecord[] = await cs.recipes
        .find({})
        .sort({ createdAt: -1 })
        .limit(MAX_PAGE)
        .toArray();

    const byTitle = (doc: RecipeRecord) => doc.titleFold ?? '';
    const exact = docs.find((doc) => byTitle(doc) === needle);
    if (exact) return exact;

    const candidates = docs.filter((doc) => {
        const folded = byTitle(doc);
        return folded.startsWith(needle) || folded.includes(needle);
    });
    return candidates.sort(
        (a, b) => byTitle(a).length - byTitle(b).length
    )[0];
}

export async function deleteRecipe(id: string): Promise<boolean> {
    const result = await cs.recipes.deleteOne({ _id: id });
    return (result?.deletedCount ?? 0) > 0;
}