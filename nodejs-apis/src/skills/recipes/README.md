# Charlie — recipes skill (cooking)

One cooking library for the house, filled from **Marmiton** and read like a
scanned recipe.

```
GET /api/recipes/search?q=poulet   ──▶ search page (cards: title, url, rating)
                                        │  ranked: value, then #reviews
                                        ▼
POST /api/recipes/import {url}     ──▶ recipe page → schema.org/Recipe JSON-LD
                                        │  parse.ts: titles, yields, ISO times,
                                        │  ingredient lines, steps, rating
                                        ▼
                                   recipes collection (upsert by `marmiton:16969`)
                                        │
                                        ├─ GET    /api/recipes        the library
                                        ├─ DELETE /api/recipes/:id
                                        └─ POST   /api/recipes/:id/actions/add-to-shopping
```

## Where the pieces live

| File | Responsibility |
| --- | --- |
| `recipe.ts` | the shared domain: unit vocabulary (`RECIPE_UNITS` + the household's), `recipeUnitLabel`, `summarizeRecipe`, `addRecipeIngredients` |
| `parse.ts` | **pure** parsing of a page: JSON-LD, title suffix, yields, ISO-8601 times, ingredient lines, search cards, ranking, `spokenRecipeQuery` |
| `marmiton.ts` | the only site-aware file: `searchMarmiton` / `fetchMarmitonRecipe`, throttle, cache, test seam |
| `store.ts` | the `recipes` collection (upsert by `sourceKey`, folds, search, title lookup) |
| `index.ts` | the public API every caller uses (REST, agent, voice) |
| `api.ts` | the REST table |

`vision/modules/recipe.ts` imports the same vocabulary and supplies
`RECIPE_SCHEMA`/`RECIPE_PROMPT`: a scanned recipe and an imported page produce
the **same `Recipe`** (`types.ts`), so `components/RecipeBody` draws both.

## What is a fact, and what is a rule

- The recipe comes from the page's `schema.org/Recipe` JSON-LD — a standard
  published for machines. Nothing is scraped twice.
- Only the **search cards** are site-specific markup (`parseSearchCards`); the
  page's own JSON-LD `ItemList` is **not** the result list (a nonsense query
  returns unrelated entries — see `__tests__/fixtures/README.md`).
- Every title carries ` : la meilleure recette`; the suffix is stripped so the
  library dedupes on the recipe, not on the site's SEO copy.
- A unit is kept only when a positive quantity backs it, and only from the
  household vocabulary (`sel`, `1 bouquet garni` → no unit). A parenthesised
  precision becomes `ingredient.note`.
- **Rating**: the value and the number of reviews are stored. Ranking is
  `value` then `count`, and a card with **fewer than `MIN_RATED_COUNT` (5)
  reviews is not chosen** — a sponsored 5/5 on 2 avis is not a recipe to cook
  from. `{query}` imports therefore take `index 0` of that ranking, which is what
  "prends la meilleure recette de poulet basquaise" means.
- One shape, one merge: `addRecipeIngredients` uses the shopping list's
  `foldName` + `mergeItems`, so "3 gousses d'ail" completes a line already asked
  for instead of duplicating it.

## Network policy

| Rule | Why |
| --- | --- |
| `/recettes/recherche.aspx?aqt=…` only, **never** `?page=` | `robots.txt` disallows `/recettes/recherche.aspx?page=` and `?aqt=*page*`; recipe pages themselves are allowed |
| ≥ 1 s between requests, 10 s deadline, identifying UA | politeness, and a hung request must not hold the tab |
| search cached 10 min, pages 24 h, in-flight shared | the same click twice is one request (as in `skills/weather`) |
| `sourceUrl` stored with every record | attribution, and a page that moves is one click away |

Only a personal, user-initiated library is intended: no bulk import, no
redistribution of Marmiton content. The search is capped at one page because
pagination is out of bounds for robots, which is why a pasted **URL** import is a
first-class path.

## Adding another site

Write another adapter exposing the same two calls (`search(query)` →
`RecipeCandidate[]`, `fetch(url)` → `ParsedRecipePage`) and give it a
`sourceKey` prefix (`source: id`). Parsing already lives in `parse.ts` whenever
the site publishes JSON-LD; nothing else changes — no route, no panel, no tool.

## Settings

**None.** The skill is always on: it adds no background work (nothing is fetched
until somebody searches or imports), so there is nothing to switch off.

## Tests

```
npx jest src/skills/recipes
```

`parse.test.ts` runs on the **captured** pages in `__tests__/fixtures/`
(provenance in its `README.md`), `marmiton.test.ts` on a stubbed `fetch` (the URL
shape, the cache, the refusal paths) and `store.test.ts` on an in-memory Mongo
(upsert, folds, ordering, title lookup). `vision/__tests__/recipe.test.ts` stays
green unchanged: that is the proof the moved recipe shape is the same one.