# Echo-Cook P1 — screen bundles (`ui.bundle/1`)

This document is the contract between Charlie (the brain) and the ESP32-P4
firmware for the pull-based UI. It covers the wire format, the device-side
behaviour, the limits the firmware enforces and the HTTP endpoints involved.

The companion documents are:

* `docs/P0_INFRASTRUCTURE.md` — the hardware, LVGL plumbing and boot sequence.
* `docs/ui-bundle.schema.json` — the JSON Schema generated from the Charlie Zod
  source (`charlie/nodejs-apis/src/echo/ui/schema.ts`).
* `docs/ui-bundle.example.json` — a complete, valid bundle.
* `components/echo_screen/include/echo_screen_schema.h` — the same enums and
  limits, mirrored for the C++ parser.

## 1. Why pull, and why JSON

The device renders its own UI. Charlie never pushes pixels and never opens a
connection to the panels: it publishes a versioned JSON document (the *bundle*),
and the device polls a tiny revision document, downloads the bundle when the
hash changed, and renders it with LVGL.

This keeps the device in charge of its own frame rate, makes the UI survive a
Wi-Fi drop (the last bundle is cached in SPIFFS), and lets one page serve both
panels because the layout is described as flex containers rather than fixed
coordinates. The 10.1" DSI panel (800×1280) and the 3.5" SPI panel (480×320)
reflow the same tree.

HTML is only an *authoring* format. Charlie compiles it to the bundle with
`cheerio` (`src/echo/ui/render.ts`); the device never parses HTML and never runs
JavaScript. Actions are interpreted on the device, so a tap costs no network
round trip. Only `call` actions reach Charlie.

## 2. Transport

All exchanges are plain HTTP against the Charlie API (default port 9300, the
`echo_ha` server IP). The device identifies itself with the `X-Echo-Mac` header;
v1 has no shared secret.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/echo/:id/ui/rev` | Cheap poll: `{ rev, hash, pages }`. |
| `GET` | `/echo/:id/ui` | The bundle. `ETag` = bundle hash; `304` when unchanged. |
| `GET` | `/echo/:id/ui/vars?p=…` | Batch-resolve `external.*` variables. |
| `POST` | `/echo/:id/ui/actions` | A `call` action: `{ action, params }`. |
| `PUT` | `/echo/:id/ui` | Publish a bundle (JSON). |
| `PUT` | `/echo/:id/ui/html` | Publish from HTML (compiled on Charlie). |

`:id` is the device id (the MAC without separators). The revision document is
deliberately tiny so the device can poll it every 30 s without cost; the bundle
itself is only downloaded when `hash` differs from the cached copy.

### WebSocket is not used for bundles

The Home Assistant WebSocket channel caps frames at 1024 bytes
(`echo_ha.cpp`). A bundle is 10–200 KB, so it travels over HTTP. The WebSocket
stays for commands and status only.

## 3. Bundle envelope

```json
{
  "schema": 1,
  "rev": 42,
  "hash": "<sha256 of the document without hash>",
  "generatedAt": "2026-11-22T10:00:00.000Z",
  "defaults": { "main": "home", "aux": "status" },
  "theme": { "...": "..." },
  "vars": { "...": "..." },
  "pages": [ "...": "..." ]
}
```

* `schema` — always `1` for this contract.
* `rev` — monotonically increasing revision. The device uses it in logs and in
  the `ECHO_EVT_UI_BUNDLE_LOADED` event.
* `hash` — SHA-256 over the canonical JSON of the document without `hash`. It is
  the HTTP `ETag`, so an unchanged bundle is never re-downloaded.
* `defaults` — which page each panel shows after a bundle swap. `0xFF` is not
  valid here; omit a panel to leave it on the fallback message.
* `theme` — named paints resolved by the parser (`theme.bg`, `theme.surface`,
  `theme.text`, `theme.muted`, `theme.accent`, `theme.radius`).
* `vars` — declared variables (see §5).
* `pages` — the page list (see §4).

The device keeps the parsed cJSON tree in PSRAM for the lifetime of the bundle.
Every render structure points into that tree; nothing is copied. A page build is
therefore a pointer walk, and a variable update only touches the widgets bound
to that variable.

## 4. Pages and widgets

A page is one screen for one or both panels:

```json
{
  "id": "home",
  "targets": ["main", "aux"],
  "title": "Cuisine",
  "on": { "enter": [ { "do": "call", "action": "ui.enter", "params": { "page": "home" } } ] },
  "root": { "type": "screen", "children": [ "..." ] }
}
```

* `id` — `[a-z0-9_-]{1,32}`, unique within the bundle.
* `targets` — `main`, `aux`, or both. A page that targets both renders twice, once
  per panel; the flex layout reflows each time.
* `title` — optional, used by the device for logs and the `page` event.
* `on` — page-level events (`enter`, `leave`, `var`, `interval`, `gesture`).
* `root` — the widget tree. Its type is normally `screen`.

Widget types the device renders:

| Type | Behaviour |
| --- | --- |
| `screen` | Root container. Flex column by default. |
| `row` | Flex row container. |
| `col` | Flex column container. |
| `scroll` | Container with a scroll direction. |
| `text` | Label; its text is a template. |
| `button` | Clickable container with a label. |
| `image` | Image from `src` (SPIFFS path or URL). |
| `divider` | 1 px separator. |
| `bar` | Progress bar bound to a value. |
| `toggle` | On/off switch bound to a value. |
| `list` | Scrollable column list. |

Unknown widget types are rejected by the parser (a typo is a hard error, not a
silently invisible widget).

Every widget accepts:

```json
{
  "type": "text",
  "id": "clock",
  "style": { "...": "..." },
  "text": "{{core.time.hhmm}}",
  "hidden": false,
  "disabled": false,
  "on": { "tap": [ "..." ] },
  "children": [ "..." ]
}
```

`id` is optional but required for `show`/`hide`/`enable`/`disable` actions and for
`if` conditions on a widget. It is `[A-Za-z0-9_.:-]{1,48}` and unique per page.

### Style

Styles are optional and sparse; anything absent keeps the LVGL default.

| Key | Meaning |
| --- | --- |
| `flex` | `row` or `column`. |
| `gap` | Gap between children, px (`0..200`). |
| `pad`, `padX`, `padY` | Padding, px (`0..200`). |
| `grow` | `0` or `1`: fill the parent's free space. |
| `w`, `h` | Pixels, or `"50%"`-style percentage, or `"content"`. |
| `bg`, `color` | `#RRGGBB`, `#RRGGBBAA`, or a `theme.*` token. |
| `border` | `{ "w": 0..20, "color": <paint> }`. |
| `radius` | Corner radius, px (`0..200`) or a theme token. |
| `opacity` | `0..255`. |
| `size` | Font size: one of `12`, `16`, `20`, `28`, `40`, `56`. |
| `align` | `left`, `center`, `right`. |
| `valign` | `top`, `middle`, `bottom`. |
| `scrollDir` | `v`, `h`, `none`. |
| `precision` | Float formatting for `bar`/`text`, `0..4`. |

A paint is either a literal colour or a theme token. The theme tokens are the
only indirection the device resolves at parse time; unknown tokens are an error.

### Text templates

Any `text`, `label` or `value` string may contain `{{path}}` references:

```json
{ "type": "text", "text": "Chambre {{external.devices.Chambre.temperature}} C" }
```

The device compiles the string into literal and variable segments at parse time
and re-renders only the segments whose variable changed. Unknown variables render
as the literal `{{path}}` so a missing value is visible, not blank.

## 5. Variables

Variables are declared in the bundle so the device knows how to resolve them:

```json
"vars": {
  "core.time.hhmm": { "kind": "local", "type": "string" },
  "core.sensors.temperature": { "kind": "local", "type": "float" },
  "external.devices.Chambre.state": { "kind": "remote", "ttl": 5000, "type": "string" }
}
```

* `kind: "local"` — `core.*`. The device owns the value. The owning component
  registers a getter at init (sensors, display, Wi-Fi); the store calls it when
  its TTL elapses. Nothing is polled over the network.
* `kind: "remote"` — `external.*`. Charlie resolves it. The device batches the due
  paths into one `GET /ui/vars?p=…` request and caches the answers for `ttl` ms.
  A failed fetch backs off 1 s → 30 s and dims the value until it is fresh again.

Path grammar: `^(core|external)(\.[A-Za-z0-9_-]+)+$`. A variable referenced by a
template, a `setVar`, a `toggleVar` or an `if` condition must be declared. The
HTML compiler declares the ones it finds automatically; when publishing JSON
directly, declare them yourself.

`type` is `string`, `int`, `float` or `bool`. It only affects how a float is
formatted for display (`precision`); every value is already text by the time it
reaches LVGL.

## 6. Events and actions

Each widget and page may carry an event map. Each event holds an ordered list of
actions; the device runs them in order, synchronously, on the UI task.

| Event | Fires when |
| --- | --- |
| `tap` | The widget is tapped. |
| `longPress` | The widget is long-pressed. |
| `enter` | A page becomes visible. |
| `leave` | A page is left. |
| `interval` | Every `ms` while the page is visible. |
| `var` | A bound variable changes (optional `when` guard). |
| `gesture` | A named gesture fires: `swipeLeft`, `swipeRight`, `swipeUp`, `swipeDown`, `forward`, `backward`. |

```json
"on": {
  "tap": [ { "do": "navigate", "page": "recipes" } ],
  "var": { "path": "core.net.online", "when": { "path": "core.net.online", "op": "==", "value": false }, "actions": [ { "do": "show", "id": "offline" } ] },
  "interval": { "ms": 1000, "actions": [ { "do": "reload" } ] }
}
```

### Action verbs

| Verb | Fields | Effect |
| --- | --- | --- |
| `navigate` | `page` | Push a page on the panel's stack. |
| `back` | — | Pop the panel's stack. |
| `setVar` | `path`, `value` | Write a local variable. |
| `toggleVar` | `path` | Flip a boolean variable. |
| `show` / `hide` | `id` | Show or hide a widget on the current page. |
| `enable` / `disable` | `id` | Toggle a widget's interactivity. |
| `wait` | `ms` | Delay the rest of the chain. |
| `if` | `cond`, `then`, `else` | Conditional chain. |
| `call` | `action`, `params` | POST to Charlie. |
| `reload` | — | Ask the fetch task to poll now. |

Everything except `call` runs on the device. `call` is the only action that
touches the network, and it is fire-and-forget: the device does not wait for the
answer, and Charlie's reply is only a status.

Conditions are `{ "path": "…", "op": "==" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "exists", "value": … }`.

## 7. Device behaviour

### Fetch and cache

`echo_screen` runs one HTTP task. It polls `GET /ui/rev` every 30 s (or sooner
when an action says `reload`), compares the returned `rev` with the one it is
rendering, and downloads `GET /ui` only when it changed. The bundle is written to
SPIFFS in an A/B pair (`/storage/ui/bundle.json` and `.prev`) so a failed update
never leaves the device without a UI.

On boot the cached bundle is parsed and rendered *before* Wi-Fi is up. Only when
there is no cache at all do both panels show the "Waiting for UI from Charlie"
message painted by `echo_ui`.

### Navigation

Each panel has its own page stack. `navigate` pushes, `back` pops. Built-in
gestures do the same without a bound action:

* swipe left / right — next / previous page for that panel;
* swipe up / down — scroll the page;
* PAJ7620 forward / backward — enter / back.

### Rendering

A page is built once per panel and kept; switching pages only calls
`lv_screen_load()`. A variable update re-renders the segments bound to that
variable and nothing else. All LVGL calls happen on the UI task, inside the lock
that `echo_ui` owns; the service hook drains the request queue on every tick.

## 8. Limits

The parser enforces these; a bundle that exceeds one is rejected whole (the
device keeps rendering its previous revision).

| Limit | Value |
| --- | --- |
| Bundle size | 192 KB |
| Pages | 32 |
| Widget nesting depth | 8 |
| Widgets per page | 256 |
| Declared variables | 64 |
| Nested `if` actions | 4 |
| Template segments per string | 16 |

Memory: the parsed cJSON tree stays resident in PSRAM (~200–300 KB for a large
bundle) and the render tree holds pointers into it, so page builds copy no
strings. LVGL is built with `CONFIG_LV_USE_STDLIB_MALLOC` (CLIB) so widget trees
allocate from PSRAM rather than a fixed pool.

## 9. Configuration

| Kconfig | Default | Meaning |
| --- | --- | --- |
| `CONFIG_ECHO_SCREEN_ENABLED` | `y` | Build the renderer. |
| `CONFIG_ECHO_SCREEN_HTTP_PORT` | `9300` | Charlie API port (the WebSocket bridge uses 9303). |
| `CONFIG_ECHO_SCREEN_POLL_INTERVAL_S` | `30` | Revision poll interval, seconds. |
| `CONFIG_ECHO_SCREEN_REMOTE_VAR_REFRESH_MS` | `1000` | Floor between two `external.*` batches. |
| `CONFIG_ECHO_SCREEN_BUNDLE_PATH` | `/storage/ui/bundle.json` | Cached bundle path (a `.prev` copy sits next to it). |

The server address comes from the `echo_ha` configuration; the device sends its
MAC in the `X-Echo-Mac` header on every request. v1 has no shared secret.

## 10. Authoring in HTML

The brain authors HTML; `src/echo/ui/render.ts` compiles it to a bundle on
Charlie. The device never parses HTML.

```html
<section data-page="home" data-targets="main,aux" data-title="Cuisine">
  <h1>Bonsoir</h1>
  <p>Chambre {{external.devices.Chambre.temperature}} C</p>
  <button data-on-tap="navigate:recipes">Recettes</button>
</section>
```

* Each `<section data-page="…">` is a page. `data-targets` defaults to both panels.
* Semantic tags map to widgets: `h1`–`h6` → `text` (font 56/28/20…), `p` → `text`,
  `button` → `button`, `img` → `image`, `hr` → `divider`, `ul`/`ol` → `list`,
  `row`/`column` classes → `row`/`col`.
* Style comes from `data-*` attributes: `data-flex`, `data-gap`, `data-pad`,
  `data-pad-x`, `data-pad-y`, `data-bg`, `data-color`, `data-radius`, `data-size`,
  `data-align`, `data-valign`, `data-border` + `data-border-color`, `data-w`,
  `data-h`, `data-grow`, `data-opacity`, `data-scroll`, `data-precision`,
  `data-hidden`, `data-disabled`.
* Events come from `data-on-tap`, `data-on-longpress`, `data-on-enter`,
  `data-on-leave`, `data-on-var`, `data-on-interval`, and
  `data-on-gesture-swipeleft` / `-swiperight` / `-swipeup` / `-swipedown` /
  `-forward` / `-backward`.
* Action shorthand: `navigate:recipes`, `back`, `setVar:core.x=true`,
  `toggleVar:core.x`, `show:id`, `hide:id`, `reload`, `call:devices.toggle?{"name":"Chambre"}`.
  Separate several with `;`, or use a JSON array for nesting (`if`, `wait`).
* Theme and variable overrides: `<meta name="ui-theme" content='{"bg":"#101418"}'>`
  and repeated `<meta name="ui-var" data-path="core.x" data-kind="local">`.

Publish with `PUT /echo/:id/ui/html` (body: the markup, or
`{html, theme?, vars?, defaults?, generatedAt?}`). Publishing JSON directly still
works with `PUT /echo/:id/ui`.

## 11. Keeping the two sides in sync

Charlie's Zod schema (`src/echo/ui/schema.ts`) is the source of truth. Three
artifacts are generated from it and committed:

| Artifact | Consumer |
| --- | --- |
| `ui-bundle.schema.json` | JSON Schema for editors and validators. |
| `docs/ui-bundle.schema.json` | The firmware repo's copy (diffed by the drift test). |
| `components/echo_screen/include/echo_screen_schema.h` | Enums and limits for the C++ parser. |

`src/echo/ui/schema.test.ts` regenerates the JSON Schema and fails when the
committed copy differs, so a contract change cannot land without updating both
repos. The firmware's `echo_screen_bundle.cpp` enforces the same limits; when a
limit changes, update `UI_LIMITS` in `schema.ts` and `ES_MAX_*` in
`echo_screen_schema.h` together.

## 12. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Panels show "Waiting for UI from Charlie" | No cached bundle and no Wi-Fi/Charlie reachability. Check the `es_fetch` log lines and the `X-Echo-Mac` header. |
| Bundle rejected, previous UI still shown | A limit in §8 exceeded, an unknown widget type, or an undeclared variable. The parser logs the reason at `es_bundle`. |
| Values stuck at "{{…}}" | The variable is not declared in `vars`, or its getter was never registered. |
| Remote values dimmed | Charlie could not be reached; the device keeps the last value and backs off 1→30 s. |
| Text renders as boxes | A font size outside 12/16/20/28/40/56, or a glyph outside Latin-1. |

The JSON example in `docs/ui-bundle.example.json` is a complete, valid bundle; the
device's parser accepts it as-is.



