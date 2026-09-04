# 🤖 Charlie — Home Assistant

A self-hosted, privacy-first home assistant with full offline capability through local NLU, ASR, and TTS models.

More advanced SMART features are available through possibility for MCP with Mistral AI support.

---

## ✨ Features

- 🔌 **Fully offline** — NLU and device support can run entirely without internet connectivity
- 🌍 **Multilingual** — NLU is configured for French by default; other languages are supported via a `.yml` config file. ASR (Qwen) also supports multiple languages, configurable in `docker-compose.yml`
- 🔊 **Voice synthesis** — TTS via Piper (French voices included); alternative voices can be sourced from the piper online voices
- 📡 **Echo device support** — Any device capable of streaming PCM16 audio over WebSocket is compatible

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

## 🐍 Backend

A Python/FastAPI service responsible for running AI models and acting as an MCP client proxy. It exposes REST endpoints consumed by the Node.js backend.

### 🤖 AI Agent

`llm` service will startup `llama.cpp` server after downloading one of the latest `qwen` model compatible with tool calling.

The setting `flow.agentic.enabled` needs to be turned on for the flow to be enhanced with agentic fallback in case NLU doesn't get it.

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

- **Management** of home (devices, rooms, activities, routines)
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
LLM_HOST=localhost:9308

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

### 🎤 ASR

ASR is powered by a separate service: [`qwen-asr`](https://github.com/QuentinV/qwen-asr)

### 🎤 Text-to-Speech (TTS)

Text to speech is using Piper through python implementation.
To run it separatly:

```
docker compose up tts --build
```

Available endpoint: `POST http://localhost:9301/tts { "text": "Salut !" }`

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

---

## 🔌 Device Provider APIs

### 📨 MQTT — `default_custom`

Enable MQTT in environment configuration.

- **State publishing:** `device/{deviceId}/state`
- **State control:** Send to `device/state` with payload `{ id, power, state }`

### 🌐 HTTP — `custom_relays`

See [`esp32-devices`](https://github.com/QuentinV/esp32-devices) for the HTTP relay provider.
