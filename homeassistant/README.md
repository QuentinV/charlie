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

### Making it a good Charlie device

Installing an integration makes HA see the entity; making it a **good Charlie
device** is data, not code (see `.clinerules` → *Adding a Device Type (HA)*):

1. **Capture** the live entity payload (`/api/states/<entity_id>`), its
   `core.entity_registry` entry and the `get_services` slice of its domain.
2. **Add rows for the domain** in
   `nodejs-apis/src/devices/providers/homeassistant/domains.ts` — only when HA's
   generic attribute/service mapping is not enough. Keys are HA's own attribute
   names, `options` names the attribute carrying the value list, `write` the
   service + field.
3. **Fixture** it in `nodejs-apis/src/devices/__tests__/fixtures/ha-<domain>.json`.
   The conformance suite auto-discovers it and checks the schema, option lists,
   readings, writes — and that everything advertised is readable from that payload.
4. **Nothing to do per brand in the frontend**: the UI is one panel per **device
   type** (`frontend/src/components/DeviceControls/types/` → `panels/`), so any
   integration of a supported domain renders through the existing panel. A
   provider only advertises `capabilities.control` when it wants a premium panel
   (`clim` → `ClimatePanel`).

**Brand-free rule.** The provider names no integration and no brand: a capability
comes from a domain, an entity attribute (`PARAM_OPTION_SOURCES`) or the services
catalogue. HA publishes no remote-key vocabulary (`remote.send_command.command`
is free text, like in HA's own UI), so the TV panel renders a text field, and the
sibling merge is domain-only (`siblingDomainsFor`) — every TV behaves the same,
whoever makes it.

Known limitation, HA-side: a TV whose integration does not implement power-on
(it needs Wake-on-LAN) refuses `turn_on` until a `turn_on` trigger/automation
registers the action **in HA**. Charlie surfaces HA's error verbatim; nothing is
hardcoded on this side.

Known trap: HA keeps some semantics **outside** the attribute bag. A
`climate` / `water_heater` mode IS the entity state — there is no `hvac_mode`
attribute — and a water heater's list attribute is `operation_list` (not
`operation_modes`). The provider publishes such values as properties (it does for
the climate mode) and the fixture proves they are readable; otherwise the UI
silently falls back to a default and shows the wrong mode.

The same rule covers measurements and levels. A `sensor` / `binary_sensor` keeps
its value in the entity state and names it with `device_class`, so the provider
publishes `properties.temperature` / `properties.motion` (an `unavailable` entity
publishes no reading). `level` is Charlie's canonical numeric value, so **every
domain that has one publishes it** (`LEVEL_SOURCES`: brightness, cover position,
volume, fan percentage, humidity, ambient temperature for a `climate` /
`water_heater`, a `sensor` reading, `battery_level` where nothing else is
numeric), taking a measured value before a setpoint. A *writable* level is a
second, narrower table (`LEVEL_FIELDS`) advertised only when the gateway proves
it (the attribute or the HA feature bit), so an on/off bulb has no slider, a
media player without `VOLUME_SET` keeps the step service, and a thermostat shows
its ambient temperature without offering a level control — writing `level` there
is ignored, the setpoint is the `temperature` property. A domain whose support is
only its services catalogue (`lock`, `vacuum`, `fan`, `camera`, `humidifier`)
renders through the domain-agnostic function list: one control per advertised
function, `inputSchema`-driven, free fields as text. No per-brand command list
exists anywhere.

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
