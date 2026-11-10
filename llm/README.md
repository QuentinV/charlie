# Charlie LLM service

One `llama-server` container serves **several models** thanks to llama.cpp's
[router mode](https://github.com/ggml-org/llama.cpp/pull/17470)
(`--models-dir`): a request names the model it wants (`model` field of
`/v1/chat/completions`), the router loads it **on demand** and keeps it warm.

| Model id                  | Used by                                      |
| ------------------------- | -------------------------------------------- |
| `qwen3-4b` (Qwen3-4B)     | conversation, agentic fallback, memory summary |
| `qwen3-1.7b` (Qwen3)      | background jobs — the shopping list restructurer |
| `qwen3vl-4b` (Qwen3-VL-4B)| image description (multimodal, `mmproj`)     |

They are declared in `MODELS` (`<id>=<hf-repo>/<file.gguf>`, space/comma
separated) and downloaded into `$MODEL_DIR/<id>/<file>`. A multimodal model adds
its projector with a `+` — both files land in the same folder, which is what the
router's directory scan expects (see *Multimodal* below):

```sh
qwen3vl-4b=Qwen/Qwen3-VL-4B-Instruct-GGUF/Qwen3VL-4B-Instruct-Q4_K_M.gguf+Qwen/Qwen3-VL-4B-Instruct-GGUF/mmproj-Qwen3VL-4B-Instruct-F16.gguf
```

The router names a model after **its folder** (verified against the running
router: `GET /v1/models` → `qwen3-4b`, `qwen3-1.7b`, `qwen3vl-4b`), which is why
each model gets its own folder — the ids are what `LLM_MODEL`,
`LLM_SMALL_TASK_MODEL` and `VISION_MODEL` use in the brain. A model downloaded
by the previous single-model layout is **moved** into its folder instead of
downloaded again. The router serves every `.gguf` it finds under `--models-dir`;
`MODELS` only controls what this entrypoint downloads.

## Load on demand, stayed warm

* Nothing is loaded at startup. The first request naming a model triggers the
  load (`GET /models` shows the state; the brain warms the chat models at boot
  with `POST /models/load`, see `nodejs-apis/src/ai/llm.ts` — the vision model is
  deliberately left out of that warmup, see below).
* A loaded model **stays resident**: the scheduler only evicts an idle model
  when a request needs a slot above `--models-max` (LRU). The pinned build
  (b9085) has **no** `--models-memory-margin`, only `--models-max`.
* To give RAM/VRAM back between sessions, set `LLAMA_SLEEP_IDLE_SECONDS=900`
  (`--sleep-idle-seconds`): the model + KV cache are unloaded after N seconds
  without a request and reloaded on the next one.

### Vision, the cheap way

The vision model is the reason `MODELS_MAX` defaults to **2** rather than 3: the
router keeps only the two most recently used models, so once chat *and* the small
model are in use again the description (2.4 GB model + 0.8 GB projector + KV)
loses its slot — nothing has to be unloaded by hand. Note the LRU only kicks in
when a *third* distinct model is requested: on a quiet house where only chat is
used, a description stays warm (that is what `MODELS_MAX=1`, or
`LLAMA_SLEEP_IDLE_SECONDS=900` — which unloads *every* model after 15 min idle —
are for). Measured on CPU: first call ~80 s (includes the 3.1 GB load), warm call
~9 s, and the chat model still answers normally afterwards.

## Knobs (compose / env)

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `MODELS` | 4B + 1.7B + VL-4B | `id=repo/file.gguf` list to serve; `+repo/mmproj.gguf` for a multimodal model |
| `MODELS_MAX` | `2` | loaded models at once (LRU above that; `1` on a small GPU) |
| `LLAMA_SLEEP_IDLE_SECONDS` | unset | idle sleep before unloading a model |
| `MODELS_PRESET` | `/app/presets/charlie.ini` | **the only place per-model tuning is defined**; `""` disables it, a path replaces the file |
| `LLAMA_ARG_N_GPU_LAYERS` | unset (CPU) / `99` (GPU) | layers offloaded per model (per model in the preset) |
| `LLAMA_ARG_KV_UNIFIED` | `on` | share the KV cache across slots (memory) |

The service healthchecks `GET /health` on its own port (the base image probes
8080, which the router does not listen on).

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
(chat), `LLM_SMALL_TASK_MODEL` (small model) and `VISION_MODEL` (image
description). Leave the model variables empty to keep talking to a single-model
server.

## Multimodal (vision)

**One folder = one model, its `mmproj` is a sidecar.** `llama-server` scans
`--models-dir` and, inside each sub-folder, sorts the `.gguf` files it finds: the
projector (`mmproj…gguf`) becomes `-mm/--mmproj` of *that* model, a `…-00001-of-…`
file is a shard, anything else is the model itself
(`common/preset.cpp`). So this layout is all it takes, and nothing has to be
configured:

```
/app/models/qwen3vl-4b/Qwen3VL-4B-Instruct-Q4_K_M.gguf
/app/models/qwen3vl-4b/mmproj-Qwen3VL-4B-Instruct-F16.gguf
```

Consequences worth remembering:

* never set `LLAMA_ARG_MMPROJ` (nor `LLAMA_ARG_MODEL`) in `charlie.ini`: the scan
  fills both, and a projector at the *root* of `--models-dir` is skipped (it is a
  companion file, not a model);
* the folder is scanned **at startup only** — after dropping a new folder in
  `llm/models/`, restart the service (`docker compose restart llm`); a folder
  deleted while the router runs stays listed until the next start;
* a folder that matches no `MODELS` entry is still served, but its `[section]`
  makes the entrypoint drop the **whole** preset file (it validates sections
  against the ids declared in `MODELS`), so declare it there;
* the model stays on the CPU even on the GPU compose: its preset pins
  `LLAMA_ARG_N_GPU_LAYERS = 0` and `LLAMA_ARG_MMPROJ_OFFLOAD = off`, so its
  VRAM stays free for the chat model. Remove those two lines to accelerate it;
* the brain calls it through `describeImage()` (`nodejs-apis/src/ai/llm.ts`) with
  `model: VISION_MODEL` and a content array
  (`[{ type: 'image_url', … }, { type: 'text', … }]`) — an http(s) URL or a
  `data:image/…;base64,…` payload both work. Verify the end to end with:

```sh
# child args must show --mmproj, the preset's --ctx-size/--threads and, on GPU,
# --n-gpu-layers 0 --no-mmproj-offload
curl -s localhost:9308/models | jq -r '.data[] | select(.id=="qwen3vl-4b") | .status.args | join(" ")'
```


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

[qwen3vl-4b]             # vision: room for image tokens, kept on the CPU
LLAMA_ARG_CTX_SIZE = 4096
LLAMA_ARG_N_GPU_LAYERS = 0
LLAMA_ARG_MMPROJ_OFFLOAD = off
```

Keys are option **env names** (`llama-server --help` documents them), and a
section never sets `LLAMA_ARG_MODEL` (nor `LLAMA_ARG_MMPROJ` for a multimodal
folder): the router fills both from the folder scan. A wrong key is fatal for the
server (`failed to initialize router models: option 'X' not recognized in preset
'Y'`), so the entrypoint validates the file before passing it — an unknown key,
or a section whose name is not an id declared in `MODELS`, makes it log a warning
and start **without any preset** (the chat models then fall back to their native
262144 context, hence a huge KV cache):

```
[entrypoint] WARNING: preset key 'LLAMA_ARG_NOPE' unknown to this build, ignoring /presets/bad.ini
[entrypoint] Using per-model presets from /app/presets/charlie.ini
```

Check that it applied — `GET /models` exposes the exact spawn args of each
model, so this works even before anything is loaded:

```sh
curl -s localhost:9308/models | jq -r '.data[] | "\(.id) \(.status.args | join(" "))"'
# qwen3-1.7b  /app/llama-server … --ctx-size 2048 --batch-size 512 --threads 4 …
# qwen3-4b    /app/llama-server … --ctx-size 4096 --batch-size 1024 --threads 6 …
# qwen3vl-4b  /app/llama-server … --ctx-size 4096 --threads 4 --n-gpu-layers 0
#               --model …/qwen3vl-4b/Qwen3VL-4B-Instruct-Q4_K_M.gguf
#               --mmproj …/qwen3vl-4b/mmproj-Qwen3VL-4B-Instruct-F16.gguf
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
# qwen3vl-4b
```

Those are the values in `LLM_MODEL` / `LLM_SMALL_TASK_MODEL` / `VISION_MODEL`
(`nodejs-apis/.env`). The brain tolerates a mismatch: it retries once without the
`model` field (logged), which keeps a single-model deployment working.

## Older images

The entrypoint probes `llama-server --help` for `--models-dir`: if the pinned
build has no router mode, it falls back to a single-model server on the chat
model (`-m … -a qwen3-4b`) instead of failing to start.
