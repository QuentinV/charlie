# Captured Marmiton fixtures

These files are **captured**, never invented: an invented fixture keeps the
suite green while a real page renders wrong (the same rule the vision fixtures
follow).

| File | Captured from | What it is |
| --- | --- | --- |
| `marmiton-recipe-poulet-basquaise.json` | `https://www.marmiton.org/recettes/recette_poulet-basquaise_16969.aspx` (2026-11-20) | the `schema.org/Recipe` node of the page's `application/ld+json` `@graph`, verbatim (re-serialised by PowerShell, values untouched) |
| `marmiton-recipe-pate-a-crepes.json` | `https://www.marmiton.org/recettes/recette_pate-a-crepes-simple_27121.aspx` (2026-11-20) | same, chosen because its yield is an item count (`"20 crêpes"`) instead of people, and it has a decimal quantity with a recipe-only unit (`"0.5 verre de bière"`) |
| `marmiton-search-poulet.html` | `https://www.marmiton.org/recettes/recherche.aspx?aqt=poulet` (2026-11-20) | the `<li class="search-list__item">…</li>` result cards (17 of them), wrapped in a bare `<ul>`; everything outside the cards is dropped |

## What the captures proved (and why the code looks like it does)

- **Recipe pages carry a complete `schema.org/Recipe` node**: name, category,
  `recipeYield`, `prepTime`/`cookTime`/`totalTime` (ISO-8601), every ingredient
  line, `HowToStep` instructions, author, keywords and `aggregateRating`
  (`4.7`, 692 reviews). No HTML scraping is needed for the recipe itself.
- **Every title carries an SEO suffix**: `"Poulet basquaise : la meilleure
  recette"` (`og:title` too, checked on five pages) — hence
  `RECIPE_TITLE_SUFFIX`.
- **Ingredient lines are free French text**, so the parser has real cases:
  `700 g de poivrons (verts et rouges)` → quantity/unit/name/note,
  `3 gousses d'ail` → the recipe-only `gousse` unit, `1 bouquet garni` → no unit
  (never invent one), `sel` → a name only.
- **The search page's own JSON-LD `ItemList` is NOT the result list.** A nonsense
  query (`aqt=zzzzqx`) returned a *crêpe* list, i.e. the block is stale/global —
  parsing it would answer the wrong recipe. The result cards are always right,
  which is why `parseSearchCards` splits `<li class="search-list__item">` blocks
  and the recipe is then read from its own page

Re-capture with:

```powershell
$r = Invoke-WebRequest -Uri '<url>' -UseBasicParsing
$m = [regex]::Matches($r.Content, '(?is)<script[^>]*application/ld\+json[^>]*>(.*?)</script>')
(($m[0].Groups[1].Value | ConvertFrom-Json).'@graph' | Where-Object { $_.'@type' -eq 'Recipe' }) | ConvertTo-Json -Depth 10
```