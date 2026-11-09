# Charlie LLM service

One `llama-server` container serves **several models** thanks to llama.cpp's
[router mode](https://github.com/ggml-org/llama.cpp/pull/17470)
(`--models-dir`): a request names the model it wants (`model` field of
`/v1/chat/completions`), the router loads it **on demand** and keeps it warm.

| Model id                  | Used by                                      |
| ------------------------- | -------------------------------------------- |
| `qwen3-4b` (Qwen3-4B)     | conversation, agentic fallback, memory summary |
| `qwen3-1.7b` (Qwen3)      | background jobs — the shopping list restructurer |

Both are declared in `MODELS` (`<id>=<hf-repo>/<file.gguf>`, space/comma
separated) and downloaded into `$MODEL_DIR/<id>/<file>`. The router names a
model after **its folder** (verified against the running router:
`GET /v1/models` → `qwen3-4b`, `qwen3-1.7b`), which is why each model gets its
own folder — the ids are what `LLM_MODEL` / `LLM_SMALL_TASK_MODEL` use in the
brain. A model downloaded by the previous single-model layout is **moved** into
its folder instead of downloaded again. The router serves every `.gguf` it finds
under `--models-dir`; `MODELS` only controls what this entrypoint downloads.

## Load on demand, stayed warm

* Nothing is loaded at startup. The first request naming a model triggers the
  load (`GET /models` shows the state; the brain warms both models at boot with
  `POST /models/load`, see `nodejs-apis/src/ai/llm.ts`).
* A loaded model **stays resident**: the scheduler only evicts an idle model
  when a request needs a slot above `--models-max` or when the memory margin is
  exceeded (LRU). 
* To give RAM/VRAM back between sessions, set `LLAMA_SLEEP_IDLE_SECONDS=900`
  (`--sleep-idle-seconds`): the model + KV cache are unloaded after N seconds
  without a request and reloaded on the next one.

## Knobs (compose / env)

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `MODELS` | 4B + 1.7B | `id=repo/file.gguf` list to serve |
| `MODELS_MAX` | `2` | loaded models at once (LRU above that; `1` on a small GPU) |
| `LLAMA_SLEEP_IDLE_SECONDS` | unset | idle sleep before unloading a model |
| `MODELS_PRESET` | `/app/presets/charlie.ini` | **the only place per-model tuning is defined**; `""` disables it, a path replaces the file |
| `LLAMA_ARG_N_GPU_LAYERS` | unset (CPU) / `99` (GPU) | layers offloaded per model |
| `LLAMA_ARG_KV_UNIFIED` | `on` | share the KV cache across slots (memory) |

Model tuning (context size, batch, threads) is deliberately **not** in the
Dockerfile nor in compose: it has exactly one definition, in
`presets/charlie.ini`. The preset file is merged over the router defaults, so a
section only lists what differs — and disabling it (`MODELS_PRESET=""`) or having
it rejected means *llama.cpp defaults*: `-c 0` = the model's native context,
hence a much larger KV cache. Measured: the shipped 4B reports
`n_ctx_train = 262144`, while a normal start loads it at `n_ctx = 4096` because
of its preset section. Add `-e LLAMA_ARG_CTX_SIZE=4096` if you want a cap
without presets.

The brain side is configured in `nodejs-apis/.env`: `LLM_HOST`, `LLM_MODEL`
(chat) and `LLM_SMALL_TASK_MODEL` (small model). Leave the two model variables
empty to keep talking to a single-model server.

## Per-model arguments (`presets/charlie.ini`)

`llama-server` derives one preset per folder under `--models-dir` and merges the
INI section of the same name **over** it, so a section only lists what differs
from the CLI/env defaults:

```ini
[qwen3-4b]                 # 4096 ctx, batch 1024, 6 threads
LLAMA_ARG_CTX_SIZE = 4096

[qwen3-1.7b]             # half the context: it only structures text
LLAMA_ARG_CTX_SIZE = 2048
LLAMA_ARG_BATCH = 512
```

Keys are option **env names** (`llama-server --help` documents them), and a
section never sets `LLAMA_ARG_MODEL`: the router fills the path from the folder
scan. A wrong key is fatal for the server (`failed to initialize router models:
option 'X' not recognized in preset 'Y'`), so the entrypoint validates the file
before passing it — an unknown key or a section matching no served model makes
it log a warning and start **without** presets instead of failing:

```
[entrypoint] WARNING: preset key 'LLAMA_ARG_NOPE' unknown to this build, ignoring /presets/bad.ini
[entrypoint] Using per-model presets from /app/presets/charlie.ini
```

Check that it applied — `GET /models` exposes the exact spawn args of each
model, so this works even before anything is loaded:

```sh
curl -s localhost:9308/models | jq -r '.data[] | "\(.id) \(.status.args | join(" "))"'
# qwen3-1.7b /app/llama-server … --ctx-size 2048 --batch-size 512 --threads 4 …
# qwen3-4b     /app/llama-server … --ctx-size 4096 --batch-size 1024 --threads 6 …
```

(The router also marks a model carrying a custom preset with `*` in the
`Available models` log block.)

## Model ids

The id is the model's folder name under `--models-dir` (verified on this
build):

```sh
curl -s http://localhost:9308/v1/models | jq -r '.data[].id'
# qwen3-4b
# qwen3-1.7b
```

Those are the values in `LLM_MODEL` / `LLM_SMALL_TASK_MODEL` (`nodejs-apis/.env`).
The brain tolerates a mismatch: it retries once without the `model` field
(logged), which keeps a single-model deployment working.

## Older images

The entrypoint probes `llama-server --help` for `--models-dir`: if the pinned
build has no router mode, it falls back to a single-model server on the chat
model (`-m … -a qwen3-4b`) instead of failing to start.
