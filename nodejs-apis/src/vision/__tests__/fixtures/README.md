# Vision fixtures — captured, never invented

Every file here is a **verbatim answer of the shipped model**, captured with the
running router; they are what the vision tests replay. Editing one by hand would
hide a prompt or schema regression behind a green suite — re-capture instead
(`npx tsx src/vision/probe.ts <image>` prints the raw answers).

| File | What it is |
| ---- | ---------- |
| `detect-recipe.json` | `{"type": "recipe"}` — classifier answer for the handwritten crêpe recipe |
| `detect-unknown.json` | `{"type": "unknown"}` — classifier answer for a photo of a PCB (not a document) |
| `recipe-extract.json` | Schema-constrained extraction of the crêpe recipe — the shipped shape |
| `recipe-free-text.json` | The same image with a free-form answer (`{type, data}`): kept as the evidence that a unit outside the enum (`gr`, `litre`) is still mapped by `parse`, and as the measurement behind keeping the extraction schema-constrained |

Provenance: `nodejs-apis/recette-de-crepe_1.png` (441 kB, handwritten, French) and
`echo-devices/docs/board.jpg`, served by `qwen3vl-4b`
(`Qwen3-VL-4B-Instruct-Q4_K_M.gguf` + `mmproj-…-F16.gguf`), CPU, `--ctx-size 4096`,
`temperature: 0`. Measured on 2026-11-11, llama.cpp router build pinned by
`llm/Dockerfile`:

| Call | Prompt tokens | Generated | Wall clock |
| ---- | ------------- | --------- | ---------- |
| classify (recipe) | 480 | 6 | 35.8 s (cold-ish) |
| classify again, same image | 72 new (420 cached) | 6 | 5.0 s |
| extract recipe | 388 | 397 | 82.4 s (up to 226 s on a busy CPU) |
| free-form answer (rejected) | 82 new | 439 | 64.1 s |

What the captured answers teach (and what the tests therefore assert):
`cook_time_s` was **omitted** (not in `required`) → `parse` defaults it to 0;
`beurre` came back as `quantity: 0, unit: "piece"` for a bare "du beurre pour la
cuisson" → a unit is dropped when no quantity backs it; and the free-form capture
wrote units (`gr`, `litre`) the closed enum would have refused — which is why the
shipped path keeps **two calls** (classify, then extract with the module's
schema): the router's prompt cache makes the second one cheap (5 s against 36 s)
and the grammar stays in charge.
