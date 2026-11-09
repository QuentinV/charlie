# Charlie automations

An automation is a **stored graph**: trigger → condition → action/notify nodes
joined by edges. The engine walks it when a trigger fires, the house graph draws
it, and a small model can draft one from a sentence.

Two neighbours are worth naming up front, because they are *not* this module:

- `src/tools/mcp/` (the agentic tools) — an `action` node does not reimplement
  anything: it runs its text through the existing `ask()`.
- The retired `src/routines/` (one CRON schedule → a list of NL actions) is what
  this module replaced: a routine is now a `CRON` trigger node plus `action` nodes.

There is **no feature flag**: the module is always active, and each automation's
own `active` flag is the only switch. `setupAutomations()` is called once at boot
(`src/index.ts`).

## Layers

One file per concern; the dependency direction is strictly downwards.

| File        | Role                                                                                                   | Its gate         |
| ----------- | ------------------------------------------------------------------------------------------------------ | ---------------- |
| `events.ts` | The in-process bus (`cron`, `manual`, `device-state`, `action-completed`) and `RunTaint`. A leaf: it imports **types only**, so no publisher can be reached through it. | — |
| `engine.ts` | Pure matching/condition helpers, plus the walker `execAutomation` (injectable runner + clock). It never schedules and never owns a lock. | `engine.test.ts` |
| `index.ts`  | Orchestration: active-automation cache, CRON scheduling, bus fan-out, and the three guards (running-lock, per-trigger cooldown, cascade depth). The only entry point the bus and the REST layer call. | — (no unit suite) |
| `effects.ts`| Correlating an action with the device states it produced, into `automation_effects`.                     | `graph.test.ts` (window/correlation cases) |
| `graph.ts`  | Pure `buildHouseGraph()`: the read-only picture. No I/O, no `cs` — the route hands it the documents.    | `graph.test.ts`  |
| `compose.ts`| NL → draft: small model, closed-enum JSON schema, evidence rules.                                        | `compose.test.ts`|
| `probe.ts`  | Not a test: prints the live model's answer per sentence, to validate a prompt change.                    | `yarn automations` |

## Data model

Field-by-field types live in `src/types.ts` (`Automation`, `AutomationNode`,
`AutomationEdge`, `AutomationEffect`); only the shape is repeated here.

```json
// collection `automations` — one document per automation (`cs.automations`)
{
  "_id": "…", "name": "Salon allumé", "active": true,
  "nodes": [
    { "id": "t1", "kind": "trigger",
      "trigger": { "type": "DEVICE_STATE",
                   "device": { "deviceId": "…", "attribute": "power", "to": "on",
                               "cooldownMs": 2000 } } },
    { "id": "c1", "kind": "condition",
      "condition": { "deviceId": "…", "attribute": "level", "op": "gt", "value": 20 } },
    { "id": "n1", "kind": "notify", "notify": { "body": "La lumière du salon est allumée" } }
  ],
  "edges": [
    { "from": "t1", "to": "c1" },
    { "from": "c1", "to": "n1", "when": "success" }
  ]
}
```

One vocabulary rule, and it is the only one this module adds: an `attribute` is
`power`, `level`, or **any free `properties` key the provider already exposes** —
there is no second mapping table. A watched value is a *transition*, not a level:
`to` (enter, the default), `from` (leave) or nothing (change), and an
`unavailable` / `unknown` reading never fires.

The second collection, `automation_effects`, holds one document per *observed*
`action → state` arc, keyed by `effectId(automationId, nodeId, deviceId,
attribute, value)` and `$inc`-counted on every re-observation, so one arc is
never duplicated.

## What actually runs

```
trigger fires ─▶ bus event ─▶ guards: match · running · cooldown · depth ≤ 8
                           ─▶ execAutomation (walk · gate edges · prune false)
                           ─▶ action → ask() | notify → push | condition → gate
                           ─▶ action-completed ─▶ bus (chains EVENT triggers)
```

1. **One event per real change.** Both event sources (HA's `state_changed` and MQTT
   `device/state`) funnel into `logDeviceState` (`devices/history.ts`), which
   publishes a device-state event only when the state fingerprint really changed —
   a re-read of a stable value is not an event.
2. **Fan-out.** Every *active* automation in the module cache whose trigger
   matches runs. `DEVICE_STATE` uses `matchesDeviceStateTrigger`; an `EVENT`
   trigger skips the automation's own completion unless `allowSelfTrigger`.
3. **Three guards, in `index.ts`** — they are orchestration, not traversal: a run
   already in flight for that automation (`running`), a trigger that fired inside
   its `cooldownMs` (`lastFired`, keyed `<automationId>:<nodeId>` — the
   flapping-sensor guard), and a chain deeper than `MAX_CASCADE_DEPTH` (8). Depth
   rides on the event as `RunTaint { origin, depth }` and every hop adds one.
4. **The walk.** `execAutomation` starts at the trigger node and follows edges: a
   trigger is never executed as a step, a node runs **at most once per run**
   (diamond/loop guard), `when: success | failure | always` gates an edge on its
   source's result, and a false `condition` prunes its whole subtree regardless.
5. **Actions are correlated while they run.** `runWithAction` carries the node in
   an `AsyncLocalStorage` context and `noteActionStarted`/`noteActionSettled` open
   a time window (`ACTION_SETTLE_MS`, 1.5 s) for a gateway that reports back on
   another chain. Any transition landing in either is recorded as that node's
   effect.
6. **`action-completed` is republished** for every `action`/`notify` node — that
   is how `EVENT` triggers chain automations, and how a feedback loop is created
   in the first place (hence step 3).

## The house graph

`buildHouseGraph(automations, effects, devices)` (`graph.ts`, pure) returns
`{ nodes, edges, stats }`; the route reads the three collections and hands them
over. Three rules turn many automations into one picture:

- **A state node is a *definition*, not an instance.** Its key is
  `deviceId|attribute` (`stateKey`) — never the value. Five automations watching
  the same lamp collapse into one node, and an action producing `power = on` on a
  device already watched on `power = off` lands on that same node: that is what
  closes a loop in the picture instead of drawing a parallel node.
- **The transition rides on the arc** — `on`, `off`, `≠ on`, `~`
  (`triggerEdgeLabel`), the same mapping `triggerStateValue` applies to
  `enter` / `leave` / `change`.
- **An effect arc is evidence, never a guess.** It is drawn from the action node to
  the state it produced, carries its `count`, and is skipped when the automation or
  node behind it is gone.

Edge kinds are `flow` (declared), `effect` (observed) and `listens` (an `EVENT`
trigger wired to the action completion it targets); an arc with a missing endpoint
is never drawn. An automation **without `_id` is skipped entirely** — the builder
is only ever handed persisted documents.

The UI lives in `frontend/src/components/Automations/`: `layout.js` is the pure
geometry (node boxes, routed arcs, `fitView` for the fixed-height canvas),
`AutomationGraph.jsx` renders it, `draft.js` previews a draft, and the page puts
one card per automation in front of it — the card is the only interactive surface,
which is what lets the graph itself stay read-only.

## Natural-language compose

`POST /api/automations/compose { text }` asks the **small** router-served model
(`LLM_SMALL_TASK_MODEL`) for a schema-constrained JSON answer (`temperature: 0`, 512
tokens) and returns `{ automation, warnings }` — a **draft**: no `_id`, not
persisted, saved only when the user confirms.

Three rules keep the model honest, and they are what let the prompt stay small:

- **Closed enums.** Trigger types, attributes, action kinds and condition ops are
  `enum`s in `AUTOMATION_SCHEMA`, so an out-of-set value cannot be emitted at all.
- **Evidence, not trust.** A device name must resolve to a real device
  (`resolveDevice`: significant-word matching that ignores accents, case and
  particles like "du"); an invented one is dropped with a warning. An attribute the
  device does not expose (`day_night` on a lamp) is remapped to `power`, also with
  a warning.
- **Every node it writes is runnable.** `looksLikeNotify` turns "préviens-moi" into
  a `notify` node whatever kind the model picked, an action keeps its French text
  verbatim (it goes back through `ask()`), and triggers are wired to the first
  condition, then the first action.

Validate a prompt change the way this repo does — probe the live model, no DB, no
unit test: `yarn automations` (`probe.ts`) prints the raw answer for five sentences.
UI wording stays in the frontend (`automations.*` keys in `fr.json` / `en.json`),
so this module holds no display strings.

## REST surface

Declared in `src/manager/automations.ts`. Express matches in registration order, so
`automations/graph` must stay declared before `automations/:id` (the file says so).

| Route                                 | Does                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /api/automations`                | list every automation                                                         |
| `POST /api/automations`               | upsert (assigns the `_id`) and reload the schedule                            |
| `POST /api/automations/compose`       | sentence → draft (`{ automation, warnings }`)                                 |
| `GET /api/automations/graph`          | the house graph, built over the three collections                             |
| `GET` / `DELETE /api/automations/:id` | one automation; deleting also drops the effects it produced                   |
| `POST /api/automations/:id/run`       | run now — the given node, else its `MANUAL` trigger, else the first trigger    |
| `POST /api/automations/:id/toggle`    | flip `active` and reload the schedule                                         |

Every write path ends in `reloadAutomations()`, which is what makes a change live:
it re-reads `{ active: true }` and reschedules the CRON nodes.

## Changing it safely

- **A trigger type** → `AutomationTriggerType` (`types.ts`), `triggerMatches`
  (`index.ts`), plus a publisher if it needs one (`events.ts` and the domain that
  emits); CRON additionally needs `startAutomation`.
- **A node kind** → `AutomationNodeKind` and `defaultRunner` (`engine.ts`), then a
  colour and a label in `frontend/src/components/Automations/layout.js`.
- **A compose field** → the schema, then the prompt, then `yarn automations`.
- **A graph rule** → `graph.ts`, which is pure and therefore unit-tested — never in
  the route, which only reads collections.

## Gates

```sh
npx jest src/automations src/devices src/ai   # module + the device layer it reads
npx tsc --noEmit                             # repo has pre-existing errors: check yours
cd ../frontend && npx eslint src/components/Automations && npx vite build
```

## Deliberate choices

- **No feature flag** — `active` per automation is the switch.
- **Loops are drawn, then contained**, not forbidden: `cycle` flags them in the
  picture while the running-lock, the cooldown and the depth limit stop them at
  runtime.
- **Effects are observed, never declared** — which is also why an action whose
  device write never happens produces no arc at all.
- **The graph is read-only**: every mutation goes through the automation document.
- **A draft has no graph** — the builder needs an `_id`, so the preview is a text
  list of the understood steps (`frontend/src/components/Automations/draft.js`).
