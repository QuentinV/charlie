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

## Troubleshooting

- **"trusted_networks login failed"** in the api logs → the brain is not
- **`allow_bypass_login` prompt** → more than one non-system user exists in HA.
  Keep a single owner (or remove extra users) for fully automatic login.
- **HA unreachable** → confirm the `homeassistant` container is up and on the
  `internal` network; the api retries at boot.
