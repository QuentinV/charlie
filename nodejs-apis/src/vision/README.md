# Charlie — vision module

One photographed document in, structured data the home can act on out.

```
POST image bytes ──▶ vision_scans{pending}          (image saved on disk)
                        │
                        ├─ type named by the caller ─────────┐
                        └─ else: ONE classifier call         │  detect.ts
                           (closed enum of module ids)       │
                                                             ▼
                            extraction with the module's JSON schema   extract.ts
                                                             │
                                     module.parse() (Zod + evidence)   modules/*.ts
                                                             ▼
                                 done ──┬─ module.summarize() → TTS/UI
                                        └─ module.actions   → e.g. the recipe library
                                 failed ──▶ image + resolved type kept, retryable
```

## Where the pieces live

| File | Responsibility |
| --- | --- |
| `index.ts` | the pipeline and its public API: `addImageScan`, `readScan`, `startReading`, `scanImage`, `rescan`, `removeScan`, `runScanAction` |
| `modules/types.ts` | the `VisionModule` contract |
| `modules/index.ts` | the registry — every consumer derives from it |
| `modules/recipe.ts` | the shipped document type (`recipe`) |
| `modules/generic.ts` | the fallback: a free description (`unknown`) |
| `detect.ts` / `extract.ts` | the two model calls |
| `logic.ts` | pure helpers: classifier schema, prompts, answer parsing |
| `images.ts` | bytes on disk, mime normalization, hash, rotation |
| `store.ts` | the `vision_scans` records |
| `api.ts` | the upload route (own body parsers) + the REST table |
| `probe.ts` | live probe of a prompt/schema change against the running router |

The model transport is **not** here: `ai/llm.ts` exposes `describeImage` (prose)
and `visionJson` (a `response_format: json_schema` answer), both routed to the
router-served `VISION_MODEL` (`qwen3vl-4b`). See `llm/README.md`.

## Adding a document type

1. **Capture the real answers first.** Put a photo in `vision/scans/` (or use any
   file) and run `npx tsx src/vision/probe.ts <image> --raw` with the prompt you
   intend to ship. Copy the model answers into
   `__tests__/fixtures/<type>-*.json` and describe the provenance (image, model,
   timings) in `fixtures/README.md`, as the recipe fixtures do — an invented
   fixture hides a prompt regression behind a green suite.
2. **Write `modules/<type>.ts`** exporting a `VisionModule`: `id`, French
   `label`, English `hint` (one sentence for the classifier), the JSON `schema`,
   the `prompt` (rules only; the schema is appended by `logic.ts`), a tolerant
   `parse` (Zod + the semantic rules a grammar cannot express), and optionally
   `summarize` and `actions`.
3. **Register it** in `modules/index.ts` — one line. The classifier enum, the
   `/api/vision` catalogue, the UI's type picker and the extraction grammar all
   pick it up; the classifier's `hint` is the only place it is described to the
   model.
4. **Test it** in `__tests__/`: the registry invariants already run over every
   module (unique ids, `required` keys present, ASCII enum tokens); add a
   `parse` test on the captured answers and, if the module has actions, an
   assertion on what they call.
5. Nothing else: no panel, no route, no settings entry, no `if (type === …)`.

For anything the model must not invent, use a **closed enum** in the schema (the
grammar then makes an invented value impossible) and, for whatever a grammar
cannot express, an evidence rule in `parse` — measured examples from the recipe
module:

* a unit with no quantity behind it is a hallucination: `{"name":"beurre",
  "quantity":0,"unit":"piece"}` was produced for a bare "du beurre pour la
  cuisson" → the unit is dropped when the quantity is absent;
* a duration key the image does not answer is simply **omitted** by the model
  (`cook_time_s` was missing from the captured answer) → never `required`, and
  defaulted to 0;
* an unknown unit is dropped rather than stored: `recipeUnitLabel` accepts the
  module vocabulary plus what the household vocabulary recognises (`gr` → `g`),
  and anything `normalizeUnit` does not know is discarded.

## REST surface

Upload (`POST`, registered **before** `express.json()`: a photo is megabytes and
the 100 kB default would reject it):

```sh
curl -X POST "$CHARLIE/api/vision/scans?type=recipe&source=api" \
     -H "Authorization: Bearer chk_…" -H "Content-Type: image/jpeg" \
     --data-binary @recette.jpg
# → 201 {"scan":{"id":"…","status":"pending", …}}   (read in background, poll it)
# JSON alternative: {"image":"data:image/jpeg;base64,…"} or {"image":"http://…"}
```

| Route | What it does |
| --- | --- |
| `POST /api/vision/scans` | upload (raw `image/*` or a `data:`/`http(s)` URL in JSON); `?type=` skips the classifier |
| `GET /api/vision/scans?type=&status=&limit=` | history, newest first |
| `GET /api/vision/scans/:id` | one scan with its data |
| `POST /api/vision/scans/:id/rescan` | re-read the stored image, `{type}` to correct the type (background again) |
| `GET /api/vision/scans/:id/image` | the stored bytes (the UI fetches it with the token: `apiBlob`) |
| `DELETE /api/vision/scans/:id` | record + image |
| `POST /api/vision/scans/:id/actions/:action` | a module action (`recipe` → `save-to-recipes`, which files it in the `recipes` collection) |
| `GET /api/vision` | status, settings and the module catalogue (ids, labels, actions) |

A scan is a private document: nothing here is in the auth allowlist, and the
upload/re-read routes are deliberately **not awaited** end to end — a CPU vision
read takes tens of seconds to minutes, far beyond a proxy timeout — so they
answer `pending` and the client polls (`frontend/src/components/Vision`).

## Settings (`settings.schema.ts`, tags `Vision`)

| Key | Meaning |
| --- | --- |
| `vision.enabled` | the tab, the upload route, the tools (on unless set to false) |
| `vision.keepScans` | how many images are kept on disk (default 50, oldest rotated out) |
| `vision.maxImageMb` | largest accepted upload (default 25) |

## Measurements that shaped the design

Captured on the shipped build (Qwen3-VL-4B Q4_K_M + `mmproj` F16, CPU,
`--ctx-size 4096`, greedy), against `recette-de-crepe_1.png` (441 kB, handwritten,
repo root of `nodejs-apis/`):

| Call | Tokens | Wall clock |
| --- | --- | --- |
| classify (recipe) | 480 prompt | 35.8 s |
| classify again, same image | 72 new (420 cached) | 5.0 s |
| extract recipe | 388 prompt + 397 generated | 82-118 s |
| free-form answer (rejected) | 82 new + 439 generated | 64.1 s |
| classify a non-document (a PCB photo) | — | 39 s → `unknown` ✔ |

Two conclusions shaped the pipeline: the router's **prompt cache reuses the
encoded image** between the two calls of a scan (so the second call is nearly
free — strictness wins over one-call economy), and a **single call** carrying a
free-form `data` object invents values (`unit: "litre"` for the bare butter,
`"gr"` instead of the closed enum, an ingredient the image never lists). That
alternative was implemented, measured and **removed**: the shipped path always
classifies, then extracts with the module's schema.

## Deferred

A camera entity as a second image source (HA `/api/camera_proxy/<entity_id>`,
then this same pipeline), external modules over HTTP (`plugins {type:'vision'}`),
document types beyond `recipe` + `generic` (receipt, letter, business card),
multi-page scans.

