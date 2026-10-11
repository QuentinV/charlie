# 🏠 Home Assistant — Charlie's background device-provider layer

This folder builds a **headless Home Assistant** instance that Charlie uses
exclusively as its **device-provider layer** (HA's ~3000 community
integrations: Shelly, Tuya, IKEA, Meross, Nanoleaf, Bravia, Samsung,
Mitsubishi, MQTT, Zigbee/Z-Wave, ESPHome, …).

Charlie keeps its **brain** (NLU → LLM fallback, echo audio, TTS, routines,
activities, Mongo history) and its **frontend**. The Home Assistant UI is
**never used** and is **not exposed**:

- HA runs on the Docker `internal` network, reachable only by Charlie's
  containers (and `127.0.0.1:8123` on the host for debugging).
- The Charlie brain authenticates with HA's `trusted_networks` auth provider
  (`allow_bypass_login`) — **no password, no token generation, no browser
  step**.
- Device integrations are added from **Charlie's Providers page** via a generic
  wizard that renders HA's config-flow `data_schema`.

## How auth works (zero-touch)

1. On first boot, the `charlie` owner user is created automatically via
   `POST /api/onboarding/users` (the brain does it).
2. The brain then logs in through the `trusted_networks` provider: because the
   request comes from inside the trusted Docker network and there is exactly
   one owner user, HA returns an auth code with **no credentials**.
3. `POST /auth/token` exchanges the code for an access token. The token is
   **ephemeral**: it lives only in the brain's memory and is re-provisioned
   automatically on every boot (and on a 401). Nothing is stored anywhere.

## Environment

| Env var | Default | Purpose |
| --- | --- | --- |
| `HA_TRUSTED_NETWORKS` | `172.16.0.0/12,127.0.0.1` | Comma-separated CIDRs rewired into `auth_providers` before HA boots |


## Adding device integrations

Use the **Charlie** frontend (Providers → Home Assistant → Integrations).
Every plug configures its own brand credentials there; entities then appear in
the **Discovery** page where you select which ones become Charlie devices.

The wizard lists HA's `flow_handlers`, i.e. **core** integrations only
(Shelly, Tuya, IKEA Trådfri, MQTT, Zigbee, ESPHome, …). Brand integrations
that are **not** in core — Meross, LocalTuya, Xiaomi Miot, Frigate, … — live
in the community and must be installed first (next section).

## Community integrations (HACS-compatible)

Charlie installs community integrations **natively** — no HACS UI, no GitHub
device-code flow. The brain downloads the GitHub source, drops
`custom_components/<domain>/` into HA's config dir and restarts HA so the new
integration's config-flow handler is registered. After that it shows up in the
same wizard as core integrations.

Endpoints (mounted under `/api/ha`):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/ha/community?q=meross` | Search the community catalog (HACS default list) |
| `GET` | `/api/ha/community/installed` | List installed community integrations |
| `POST` | `/api/ha/community/install` | `{ "repo": "krahabb/meross_lan" }` → install + restart |
| `POST` | `/api/ha/community/restart` | Restart HA and wait until it is back |
| `DELETE` | `/api/ha/community/:domain` | Remove an integration (restart to apply) |
| `GET` | `/api/ha/integrations/:domain/status` | Diagnose: handler ready? configured? eligible entities? |
| `GET` | `/api/ha/entities?platform=meross_lan` | Inspect HA entities: registry, live state, and whether Charlie would discover them |
| `GET` | `/api/ha/error-log?grep=meross_lan` | Tail HA's error log (debug load failures) |

### Three steps: install → configure → add to Charlie

Installing is **not** enough on its own — the integration then has to be
*configured* (a config entry created), which is what actually produces
entities. Most community integrations (Meross included) start their flow with
a **menu** step, e.g. *"Choose option" → Register a Meross cloud profile /
Manually configure a device*. The Charlie wizard renders these menu steps as
buttons and forwards the choice as `next_step_id`; it also handles
`progress`/`external` steps and multi-step forms.

1. **Install** — Community section → search `meross` → click `krahabb/meross_lan`
   (HA restarts automatically). It then appears under *Installed community
   integrations* as a clickable chip. Chips reflect live state: **Configure**
   (ready), **✓** (already configured), or **“not loaded”** (HA has not
   registered it — still starting, failed to import, or `HA_CONFIG_DIR` is
   wrong). The list auto-refreshes while the dialog is open.
2. **Configure** — follow the wizard (for Meross: *Register a Meross cloud
   profile* → email/password, or *Manually configure a device* → host/key).
   When it finishes, the entry is created and its entities appear in HA.
3. **Add to Charlie** — go to the **Discovery** page and add the Meross
   entities you want (Charlie never auto-creates devices). Cloud integrations
   may take a short while to publish devices after the first sync.

If nothing shows up, `GET /api/ha/integrations/meross_lan/status` tells you
whether the handler is registered, a config entry exists, and how many
entities are eligible for Charlie discovery.

Example — install Meross:

```bash
curl -X POST http://localhost:9300/api/ha/community/install \
  -H 'Content-Type: application/json' \
  -d '{ "repo": "krahabb/meross_lan" }'
```

> **Why a restart?** Home Assistant has no `reload_custom_integrations`
> service: a brand-new `custom_components/<domain>` (and its pip
> requirements + config-flow handler) is only picked up on startup. The brain
> calls `homeassistant.restart` (a **process** restart — the container stays
> up via `restart: unless-stopped`) and waits until HA answers again. The
> ephemeral trusted-networks session is re-provisioned automatically, so the
> only visible effect is a short "activating…" pause.

### Requirements (deployment)

The brain writes into HA's config dir, so it must be told where that is via
`HA_CONFIG_DIR`:

- **Docker (compose):** set on the `api` service:
  ```yaml
  # docker-compose.yml → services.api
  environment:
      - HA_CONFIG_DIR=/ha-config
  volumes:
      - ./homeassistant/config:/ha-config
  ```
  On Linux the mount must be writable by the api user (`node`, uid 1000); on
  Docker Desktop it works out of the box.
- **Host-run brain** (`yarn start` in `nodejs-apis`): the default is
  `../homeassistant/config`, which resolves to the repo's HA config folder when
  started from `nodejs-apis`. Override in `nodejs-apis/.env` if you start from
  elsewhere:
  ```
  HA_CONFIG_DIR=C:/Workspace/charlie/homeassistant/config
  ```

Before writing anything, the installer verifies `HA_CONFIG_DIR` looks like HA's
config dir (`.HA_VERSION` / `configuration.yaml` / `.storage`); if not, it fails
with a clear error instead of silently writing to a path HA never reads.
Extraction uses the system `tar` (present in the `node` Debian image and on
Windows 10+).

The catalog is HACS's own default list
(`raw.githubusercontent.com/hacs/default/master/integration`); browsing the
GitHub API anonymously is rate-limited, so set a token (Settings →
`devices.providers.homeassistant.community.githubToken` or the `GITHUB_TOKEN`
env var) for heavy use. The feature can be turned off with
`devices.providers.homeassistant.community.enabled=false`.

## Troubleshooting

- **"trusted_networks login failed"** in the api logs → the brain is not
- **`allow_bypass_login` prompt** → more than one non-system user exists in HA.
  Keep a single owner (or remove extra users) for fully automatic login.
- **HA unreachable** → confirm the `homeassistant` container is up and on the
  `internal` network; the api retries at boot.
- **`components.http.ban` “Login attempt or request with invalid authentication
  … Requested URL: '/api/'”** → this was the restart readiness probe polling an
  **authenticated** endpoint without a token. It now probes the no-auth
  `/api/onboarding` instead, so the warnings disappear. If the api container
  was already banned, restart the `homeassistant` container to clear the
  in-memory ban.
