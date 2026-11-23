# 🤖 Charlie — Home Assistant

A self-hosted, privacy-first home assistant with full offline capability through local NLU, ASR, and TTS models.

More advanced SMART features are available through possibility with MCP.

---

## ✨ Features

- 🔌 **Fully offline** — NLU and device support can run entirely without internet connectivity
- 🌍 **Multilingual** — NLU is configured for French by default; other languages are supported via a `.yml` config file. ASR (Qwen) also supports multiple languages, configurable in `docker-compose.yml`
- 🔊 **Voice synthesis** — TTS via Piper (French voices included); alternative voices can be sourced from the piper online voices
- 📡 **Echo device support** — Any device capable of streaming PCM16 audio over WebSocket is compatible
- 📷 **Live cameras** — a cheap motion → detector → tracker cascade with rare VLM escalation; cameras are added in the UI (webcam / RTSP / MJPEG / HA) as devices

---

## 🏗️ Architecture Overview

```
                ┌──────────────────────────┐
                │       Echo Device        │
                │  (ESP32-S3 / Browser)    │
                └────────────▲─────────────┘
                             │
                        [ WebSocket Conn ]
                             │
                             ▼
            ┌─────────────────────────────────┐       ┌──────────────┐
            │           Orchestrator          │ <───> │   MongoDB    │
            │           (NodeJS API)          │       │  (Database)  │
            └────▲───────────▲───────────▲────┘       └──────────────┘
                 │           │           │
                 ▼           ▼           ▼
          ┌───────────┐┌───────────┐┌──────────┐
          │    ASR    ││    LLM    ││   TTS    │
          │ Container ││ Container ││Container │
          └───────────┘└───────────┘└──────────┘
```

---

## 🚀 Getting Started

### 🪟 Windows

Use `docker-compose.windows.yml` to run the full stack locally. ASR requires cloning [`qwen-asr`](https://github.com/QuentinV/qwen-asr) into a sibling folder to run on CPU.

### 🐧 Linux

Use `docker-compose.yml` — it will automatically fetch and build `qwen-asr` from GitHub.

### 🎮 GPU (NVIDIA)

Use `docker-compose-gpu.yml` to run the `llm` service on GPU. It builds `llm/Dockerfile` with `LLAMA_BASE=ghcr.io/ggml-org/llama.cpp:server-cuda` and reserves the NVIDIA device, offloading all layers (`LLAMA_ARG_N_GPU_LAYERS`, default `99`).

Prerequisites on the host:

- an NVIDIA GPU with a recent driver installed
- [`nvidia-container-toolkit`](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) configured for Docker

▶️ Running

```bash
docker compose -f docker-compose-gpu.yml up llm --build
```

Or the full stack:

```bash
docker compose -f docker-compose-gpu.yml up --build
```

Tune the offload with `LLAMA_ARG_N_GPU_LAYERS` (e.g. `LLAMA_ARG_N_GPU_LAYERS=0` falls back to CPU while keeping the CUDA image).

## 🐍 Backend

A Python/FastAPI service responsible for running AI models and acting as an MCP client proxy. It exposes REST endpoints consumed by the Node.js backend.

### 🤖 AI Agent

The `llm` service starts a `llama.cpp` server in **router mode**: it serves
several models from one container, loading each one **on demand** (the request
names it) and keeping it warm — chat and tools (`Qwen3-4B`), background jobs
such as the shopping list (`Qwen3-1.7B`), image description (`Qwen3-VL-4B` + its
`mmproj`) and the fast first-look for live cameras (`SmolVLM2-500M-Video`, small
enough to stay GPU-offloaded even on an old GPU). See [`llm/README.md`](llm/README.md).

The setting `flow.agentic.enabled` needs to be turned on for the flow to be enhanced with agentic fallback in case NLU doesn't get it.

The setting `vision.enabled` (on by default) turns on the **Scan** tab and the document pipeline: photograph a document and Charlie identifies its type (a recipe today, a description for anything else) and extracts a structured result — a scanned recipe is filed in the household library with one tap (or by voice, *« enregistre la recette »*), the tab then links straight to it, and its ingredients reach the shopping list from the recipe itself. Adding a document type is one file in `nodejs-apis/src/vision/modules/`. See [`nodejs-apis/src/vision/README.md`](nodejs-apis/src/vision/README.md).

The **Recettes** tab keeps the household's cooking library: search a recipe by name or ingredient — best-rated first, and a rating needs a few reviews to count — or paste a Marmiton link, and Charlie stores its ingredients, steps, times, servings and stars in the `recipes` collection. *Ajouter aux courses* merges the ingredients with the same fold a spoken request gets, and an imported recipe has exactly the shape of a scanned one, so both tabs draw it with the same component. By voice, *« cherche une recette de poulet basquaise »* announces the best-rated candidates without saving anything, and *« ajoute les ingrédients de la recette au poulet basquaise »* fills the list.

▶️ Running

```bash
docker compose up llm --build
```

Starts on **port 9308** with a UI available on [http://localhost:9308](http://localhost:9308)

The orchestration logic is done through nodejs therefore no tools can be called from this UI.

### 🏠 Home Assistant — background device-provider layer

Since v2 there is no need to maintain my own device providers: a headless
**Home Assistant** instance (folder `homeassistant/`, port `:8123`, loopback
only) provides the device integrations. Charlie keeps its brain and frontend,
and talks to HA:

- **Zero-touch auth** — the brain auto-onboards HA once (creates a single
  owner) and then logs in through HA's `trusted_networks` provider from inside
  the Docker internal network. No tokens to generate, no browser step.
- **Configure integrations from Charlie** — Providers page → Home Assistant →
  Integrations renders HA's config-flow wizard natively (no HA UI needed).
- **Discovery** — entities appear in the Discovery page; you select which ones
  become Charlie devices.
- **State/history** — HA `state_changed` events update existing Charlie devices.

See [`homeassistant/README.md`](homeassistant/README.md) and
[`plans/home-assistant-background-provider.md`](plans/home-assistant-background-provider.md)
for details.

### 🟢 Orchestrator `nodejs-apis`

Node.js backend providing:

- **Management** of home (devices, rooms, activities, automations)
- **MCP tools** : tools are defined and send to LLM through prompt, no MCP server created but could me
- **REST API** — [Swagger docs](http://localhost:9300/api-docs)
- **Audio listeners** — WebSocket (browser) and UDP (ESP32-S3 / other echo devices)

⚙️ Environment

To run it on server no configuration required for hosts.
To run it locally, create a `.env` file in the `nodejs-apis` folder:

```env
TTS_HOST=localhost:9301
DB_HOST=localhost:27017
STT_HOST=localhost:9307
LLM_HOST=localhost:9308                 # router serving every model
LLM_MODEL=qwen3-4b                      # optional: chat + tools (router id)
LLM_SMALL_TASK_MODEL=qwen3-1.7b         # optional: background jobs
VISION_MODEL=qwen3vl-4b                 # optional: image descriptions
VISION_FAST_MODEL=smolvlm-500m          # optional: fast camera-event VLM (live vision)

SUBNET_IP=192.168.1                     # optional

TOOL_NOTIFICATION=true                  # optional
EMAIL_NOTIFICATION_USER=                # optional
EMAIL_NOTIFICATION_EMAIL=               # optional
EMAIL_NOTIFICATION_PASSWORD=            # optional
EMAIL_NOTIFICATION_TARGET_EMAIL=        # optional

TOOL_MUSIC=true                         # optional
MUSICS_DIR=                             # optional
MUSICS_PLAYER_HOST=audio                # optional

TOOL_TORRENT=true                       # optional
TORRENT_DELUGE_HOST=                    # optional
TORRENT_DELUGE_PASSWORD=                # optional

ECHO_CONTINOUS_AUDIO_TEST=true          # optional

ASR_MODEL_SIZE=large                    # optional: large | small
ASR_MODEL_PATH=./asr/models             # optional

# Home Assistant (background device-provider layer) — all optional
HA_HOST=localhost                       # default: homeassistant (compose service name)
HA_PORT=8123
# HA_AUTO_PROVISION=true
# HA_TRUSTED_NETWORKS=172.16.0.0/12,127.0.0.1   # HA container env (comma CIDRs)
# HA_ONBOARD_USERNAME=charlie           # owner user created on first HA boot
# HA_ONBOARD_PASSWORD=charlie
# HA_LOCATION_NAME=Charlie Home
# HA_TIME_ZONE=Europe/Paris
```

### 🔐 Security (login + API tokens)

The brain can require a login and API tokens. It is **off by default**; enable it
from **Settings → Security**:

1. create the administrator account (username + password, at least 8 characters);
2. the same action enables `auth.enabled` and keeps this browser signed in;
3. register named API tokens (Node-RED, a script, …) in the same panel. A token
   is displayed **once** — only its SHA-256 hash is stored.

How it works:

- `POST /api/auth/login` returns a long-lived opaque token (`chk_…`) that the web
  UI stores in `localStorage` (`charlie.auth.token`). Tokens do not expire by
  default, survive restarts/redeploys, and can be revoked at any time from
  Settings → Security.
- every `/api/*` request requires `Authorization: Bearer chk_…`, except:
  `auth/status`, `auth/login`, `auth/setup`, the Swagger page (`/api-docs`) and
  the echo firmware download.
- internal services (e.g. `vision-feed`) authenticate with a **service token**
  the brain mints at boot and writes to `nodejs-apis/.private/vision-feed.token`
  (mode 0600, gitignored); the service reads that file — no token to create by
  hand. Only the token's hash is stored, and it appears in Settings → Security as
  `vision-feed`.
- the browser chat socket `/ws/chat` authenticates with `?token=chk_…`
  (browsers cannot set headers on a WebSocket).
- `POST /api/auth/password` changes the password and signs out every other
  browser session; named API tokens are kept.

Deliberately **not** protected: the ESP32 echo WebSocket (`:9303`), MQTT
(`:9304`) and the firmware download — echo devices have no token support and
must always be able to reach Charlie. Do not expose those ports outside your LAN.

Lockout recovery — add to `nodejs-apis/.env` and restart:

```env
AUTH_BOOTSTRAP_USER=admin
AUTH_BOOTSTRAP_PASSWORD=change-me
# AUTH_BOOTSTRAP_FORCE=true   # also reset the password on every start
```

There is **no TLS** in the default compose stack: passwords and tokens travel in
clear text on the LAN. Put the stack behind an HTTPS reverse proxy before
exposing it outside your network.


### 🎤 ASR

ASR is powered by a separate service: [`qwen-asr`](https://github.com/QuentinV/qwen-asr)

### 🎤 Text-to-Speech (TTS)

Text to speech is using Piper through python implementation.
To run it separatly:

```
docker compose up tts --build
```

Available endpoint: `POST http://localhost:9301/tts { "text": "Salut !" }`

## 📷 Live Cameras (vision-feed)

A second, **live** vision path (alongside the document scanner): a cascade that
watches cameras cheaply and only escalates when something worth paying for
happens.

```
frame ─▶ motion gate ─▶ YOLO26n ─▶ IoU tracker ─▶ per-class policy ─▶ VLM (rare)
```

- **`vision-feed/`** (Python) polls the brain (`GET /api/vision/feeds`) for the
  cameras that **selected vision modes** and posts the events it detects
  (`POST /api/vision/events`); it holds no home policy — the brain does.
- A camera picks its **modes** (Presence, Pet, Entrance, Grocery, Hand gestures)
  in the device panel — a mode is a preset (classes, dwell, escalation, gestures)
  and a camera may run several at once. No mode selected = not analysed. The
  selection resolves to **one per-class policy**, so a camera watching both people
  and the cat never pays a VLM call for the cat. The selection is a durable device
  property (`Device.properties.visionModes`, `PUT /api/devices/:id/properties`),
  never state, and its rows are advertised for **every** camera — an HA one
  included, whose provider row is shared with all the other HA devices.
- Cameras are **not tied to Home Assistant**: create a `camera` provider row (one
  row per camera, in the Providers page) — its `host` is the stream (a URL, or the
  webcam index) and its settings dialog holds the kind (`webcam`, `rtsp`, `mjpeg`,
  `ha` — derived for an HA camera — or `echo`) — then add the `camera` device
  under it. The panel reads the resolved source back
  (`GET /api/devices/:id/source`) and, when it resolves to nothing, names what is
  missing (no source type, no stream URL, no entity…) instead of showing dashes.
- Events fire the ordinary **automations** (a `VISION` trigger, matchable by
  camera, mode, kind or class); an escalated
  event stores one keyframe (rotated, no video) and is described by the fast
  `smolvlm-500m` first, the heavy Qwen3-VL only on a weak answer.
- The agent can look on demand through the `camera` MCP tools
  (`describe-camera`, `add-camera-items-to-shopping`).
- Off by default: select a camera's modes. There is **no global switch** — a
  camera with no mode selected is simply not analysed, so a house with no
  configured camera has nothing to stop.

The cascade's numbers, and how to debug a feed: [`vision-feed/README.md`](vision-feed/README.md).

## 🖥️ Frontend

React application located in the `frontend` folder. Uses `yarn` for package management and `vite` for bundling.

### ⚙️ Environment

Create a `.env` file in the `frontend` folder:

```env
VITE_WEBPUSH_VAPID_PUBLICKEY=   # Generated by the server via the `generate-webpush-keys` task
```

### ▶️ Running

```bash
yarn start
```

---

## 📟 Echo Devices — ESP32-S3

Charlie supports custom-built echo devices similar to Amazon Alexa or Google Home. The ESP32-S3 microcontroller is well-suited for this use case, offering:

- ⚡ Low power consumption with Wi-Fi support
- 🎙️ Audio streaming to the Node.js server for ASR + LLM processing
- 📷 Optional camera module for facial recognition

See the [ESP32-S3 documentation](echo-devices/README.md) for build and setup instructions.

### 🖥️ ESP32-P4 — pull-based screen bundles (`ui.bundle/1`)

The ESP32-P4 drives its two displays (800×1280 DSI main + 480×320 SPI aux) from a
versioned JSON document, not from pushed pixels. Charlie owns the document; the
device polls for it, caches it in SPIFFS and renders it with LVGL. Actions run
on-device; only `call` actions travel back to Charlie.

The device identifies itself with `X-Echo-Mac: <mac>` on every request. `:id` in
the routes below is the device id (the MAC without separators).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/echo/:id/ui/rev` | Cheap poll: `{ rev, hash, pages }`. |
| `GET` | `/echo/:id/ui` | The bundle. `ETag` = bundle hash; `304` when unchanged. |
| `GET` | `/echo/:id/ui/vars?p=…` | Batch-resolve `external.*` variables. |
| `POST` | `/echo/:id/ui/actions` | A `call` action: `{ action, params }`. |
| `PUT` | `/echo/:id/ui` | Publish a bundle (JSON). |
| `PUT` | `/echo/:id/ui/html` | Publish from HTML (compiled with cheerio on Charlie). |

The contract lives in `nodejs-apis/src/echo/ui/schema.ts` (Zod, source of truth).
`ui-bundle.schema.json` and `ui-bundle.example.json` are generated from it and
committed; the firmware repo mirrors the enums and limits in
`components/echo_screen/include/echo_screen_schema.h`, and a drift test in
`schema.test.ts` fails when the committed JSON Schema differs from the generated
one. The full device-side behaviour, limits and authoring rules are documented in
the firmware repo's `docs/P1_SCREEN_DOCS.md`.

HTML is the authoring format — the brain writes markup and Charlie compiles it:

```html
<section data-page="home" data-targets="main,aux" data-title="Cuisine">
  <h1>Bonsoir</h1>
  <p>Chambre {{external.devices.Chambre.temperature}} C</p>
  <button data-on-tap="navigate:recipes">Recettes</button>
</section>
```

---

## 🔌 Device Provider APIs

### 📨 MQTT — `default_custom`

Enable MQTT in environment configuration.

- **State publishing:** `device/{deviceId}/state`
- **State control:** Send to `device/state` with payload `{ id, power, state }`

### 🌐 HTTP — `custom_relays`

See [`esp32-devices`](https://github.com/QuentinV/esp32-devices) for the HTTP relay provider.
