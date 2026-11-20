# vision-feed

`vision-feed` is the service that watches Charlie's cameras. It looks at the picture,
decides when something is worth mentioning, and publishes an **event** (`enter`, `leave`,
`dwell`, `gesture`, …) to the brain.

Two rules shape everything else:

- **It is a sensor, not a brain.** It observes and publishes; the brain (Mongo +
  automations) decides what happens. There is no home policy in this service.
- **A camera never costs a VLM.** A VLM needs seconds per frame, so it can only ever
  answer a *question about an event*. Everything before that is cheap and runs locally.

## The cascade

```
  camera ─▶ frame ─▶ Tier 0 gate ─▶ Tier 1 YOLO26n ─▶ Tier 2 tracker ─▶ policy ─▶ event
                     always          on motion          boxes → ids        │
                     sub-ms          156 ms/frame       ~0                 │
                                                                           ▼
                                                                Tier 3 VLM (rare)
                                                                smolvlm-500m → Qwen3-VL
                                                                ~1 s         → ~6.5 s
```

| Tier | What it does | When it runs | Cost (measured) |
| --- | --- | --- | --- |
| 0 — gate | gray diff on a 160×120 copy, per-cell ratio + hysteresis | always | sub-ms/frame |
| 1 — detector | YOLO26n int8, ONNX Runtime (no torch) | on motion | 156 ms/frame at 1080p |
| 2 — tracker | IoU match → stable ids | with the detector | ~0 |
| gestures | MediaPipe recognizer + rules + motion | **every frame the loop reads** | 24.7 ms/frame |
| 3 — VLM | smolvlm-500m (GPU), then Qwen3-VL (CPU) | on an event a mode asked about | ~1 s, then ~6.5 s |

The gate is what makes this affordable: a quiet house pays the gate and nothing else. The
detector only runs on motion, and the VLM only on an event.

## Where it sits

```
        ┌──────────────── the brain (nodejs-apis) ────────────────┐
        │  devices {type: camera, visionModes}                     │
        │  GET  /api/vision/feeds      ← the feed polls for cameras│
        │  POST /api/vision/events     → event + activity log      │
        │  POST /api/vision/describe   → fast VLM, then heavy      │
        │  automations bus → notify / lights / shopping            │
        └─────────────────────────────────────────────────────────┘
                 ▲                                │
    feeds (JSON) │                                │ keyframe → description
                 │                                ▼
             vision-feed ─────────────────▶ keyframe stored on disk (rotated)
```

So the split is simple: the brain owns the **registry** (which cameras, which modes) and
the **policy** (what an event means). This service owns the **pixels** and nothing else.
It authenticates with a service token the brain writes to disk at boot
(`BRAIN_TOKEN_FILE`, `/app/.private/vision-feed.token`), read on every call so a token
written after startup is picked up without a restart.

## Two rates: a frame is dropped, never queued

`VISION_FEED_FPS` (5/s) is the **decision** rate — how often the loop looks at what it has.
It is deliberately below the camera's own rate (the webcam helper publishes 10 fps), and
that difference must never become a **queue**: a publisher that keeps writing to a reader
that is behind ends up showing it the *past*, with a lag that grows without bound
(measured: ~0.5 s of lag per second of running, plus the same in heap, because nothing in
Node's `res.write` ever drops).

So both ends enforce **drop, never queue**:

- **the publisher** (`nodejs-apis/src/cameras/webcam.ts`) writes whole parts only (a raw
  chunk could cut one in half) and skips a client that already holds `QUEUE_FRAMES` frames
  of backlog. `GET /health` reports it: `frames.dropped` climbing is that reader being kept
  live instead of queued, and `frames.queueBytes` is the lag — it must stay flat.
- **the reader** (`pipeline/sources.py#MjpegSource`) **drains its socket** on every `read()`
  and returns the **newest** frame it found, counting the frames it passed over. Pulling one
  `chunk` per tick was a hard intake ceiling (`chunk × fps` = 320 KB/s at 5 fps), so a camera
  publishing more than that left everything else in the **kernel's** receive buffer: a
  picture seconds old, invisible to the publisher (Node user-space) and to `skipped` (those
  frames were never read). Measured on a real socket with a 588 KB backlog: **9 frames still
  queued** before, **0** after. `src-skipped` counts the frames passed over, `src-backlog`
  reports the bytes still unread *after* the read — a climbing backlog is the loop falling
  behind the camera, now a number instead of a surprise.

Draining costs one tick what a queue would charge every tick (a 588 KB burst = 40 frames
decoded in 78 ms once). Raising the loop rate is not the fix for a late picture: it works
only while it stays *above* the camera's rate (a 25 fps RTSP camera re-creates the lag at a
"fast" 20), and it pays decision-rate CPU for a capture-rate problem.

## Running it

### On a laptop, with no brain

```sh
cd vision-feed
python -m pip install -r requirements.txt
python main.py --source webcam                            # annotated preview window
python main.py --source webcam --headless --seconds 30    # measure
python bench.py --source webcam                           # gate + detect ms/frame
```

### The debug UI — the one to use

`debug.py` runs the **real pipeline** (the `run_brain` poll loop, `brain.py`'s client, gate
→ detector → tracker → policy → gestures) against a **mocked brain** (`mock_brain.py`, same
routes and payload shapes), and serves a page with the annotated live view and the numbers
that say whether the cascade is sane:

```sh
python debug.py --fps 10 --debug --source-url http://host.docker.internal:9312/video.mjpg --host 0.0.0.0
```

Then open the UI: `http://localhost:9313` when you are on the same machine, or
`http://<that-machine>:9313` from another one. What those flags are for:

| Flag | Why |
| --- | --- |
| `--fps 10` | the loop rate; the webcam helper publishes 10 fps |
| `--debug` | also print the `VISION_DEBUG` trace, one line a second — the same numbers as the page |
| `--source-url` | the MJPEG URL. `host.docker.internal` is the host as seen from the container; the default (`127.0.0.1:9312`) is the *container's* loopback, where no camera listens |
| `--host 0.0.0.0` | so a published port can reach it — a loopback bind is not reachable from outside |

Other flags: `--source-kind webcam --source-url 0` (a local camera), `--mode` (repeatable,
default `presence`), `--brain-url http://localhost:9300` (watch the real brain instead of the
mock), `--no-gestures` (a host without mediapipe), `--width 960` (the display copy),
`--record <dir>` (write annotated frames, 2/s). Ports: UI **9313**, mocked brain **9314**.

The page shows the MJPEG with **boxes, track ids and labels** (magenta = an id minted on
this frame, grey `~` = a track nobody confirmed, `2/?` = a track short of its `enter`), the
counters, the event timeline and the per-frame trace. The picture is drawn on a
**downscaled copy** and encoded **once per frame for every client**: a page does not need
1080p, and a debug UI that eats the pinned cores slows down the very feed it measures. The
`retard source` row and the trace's `src` column are the numbers to watch — both at 0 means
the loop is on time.

**The counters are the test.** `enters` / `leaves` count the events the *policy* emitted
(only the classes the modes watch), while **tracks minted** counts every id the *tracker*
created, furniture included (a camera pointed at a room mints ids for `bed`, `book`,
`remote` the detector flickers on — those emit nothing). So the scripted check is: stand
still ~40 s and read `enters 1 / leaves 0`, one `dwell` at ~15 s, and one `person` id.

The knobs on the page (loop fps, detect fps, detect confidence, dwell, miss TTL, grace,
enter looks, gesture score/vote, gesture rules/motion) are written to `config` and applied
by **restarting the feed** — the real stop/start path a brain poll uses — which is why
applying one resets the counters. The form is a **draft**: filled once from the running
config, and the 700 ms poll never writes to it again (it used to, which reverted a mode
checkbox before it could be applied and dropped a value the moment the focus left the
field). `#dirty` names what is waiting, "Appliquer" re-syncs the form from what the server
accepted, and what is *running* is always in the "État" panel. `detectConf` is the knob for
"the camera does not see me": at 1080p a still person is reported in single-frame bursts,
and 0.25 finds them (at the price of more furniture ids).

### In the container

The container is the right place to debug **gestures**: mediapipe and the baked `.task` live
there, and the host may not have mediapipe at all.

```sh
# the same UI, inside the service container (a second process; the feed keeps running)
docker compose exec vision-feed python debug.py --fps 10 --debug \
  --source-url http://host.docker.internal:9312/video.mjpg --host 0.0.0.0
```

For a clean CPU measurement, run it in a throwaway container instead, so the service's own
feed is not competing for the same pinned cores:

```sh
docker run --rm -p 9313:9313 --network charlie_internal \
  -v "$PWD/vision-feed:/app" -v "$PWD/nodejs-apis/.private:/app/.private:ro" \
  charlie-vision-feed python debug.py --fps 10 --debug --host 0.0.0.0 \
  --source-url http://host.docker.internal:9312/video.mjpg
```

`VISION_DEBUG=1` (or `--debug`) prints the same stats as one line a second, so a symptom can
be read in a log and then *seen* in the page.

## Cameras: a source and a mode selection

- A camera is an ordinary device of type `camera`, under a **`camera` provider row that is
  one camera** — like a Shelly row is one plug.
- The **source** is provider config: the kind (`webcam`, `rtsp`, `mjpeg`, `ha`, `echo`), the
  stream URL or device index (the provider's `host`), and an optional snapshot URL. The
  Providers page renders it (`GET|PUT /api/providers/:id/settings`).
- The **modes** belong to the device (`device.properties.visionModes`): `presence`, `pet`,
  `entrance`, `grocery`, `commands`. There is **no `off` row** — an empty selection is off.
- A camera may select **several** modes. They resolve to **one** per-class policy: the union
  of the classes, the shortest dwell per class, and escalation only for the classes whose
  modes asked (a `pet` camera never pays a VLM call). One engine, one detector, one thread
  per camera — the modes never multiply the work.
- `GET /api/devices/:id/source` reads back what the feed will open, and **why** when it
  resolves to nothing.
- A feed flagged **`relay: true`** (an `mjpeg` or `ha` camera) is read **through the brain**,
  because its URL may be host-local (the webcam helper listens on `127.0.0.1`, which inside
  the container is the container). The service token then rides in the query string, because
  a `VideoCapture` cannot send a header.

A **USB webcam** cannot always be handed to the container (Docker Desktop on Windows exposes
no camera device), so serve it as an `mjpeg` source instead:

```sh
cd nodejs-apis && yarn webcam --register    # MJPEG on http://127.0.0.1:9312/video.mjpg
```

The helper also answers `/snapshot.jpg` (one frame); put that URL in the camera's **snapshot
URL** field so the on-demand tools can look at a live camera.

## Gestures

The recognizer is loaded **per camera**, and only when one of its modes asks for gestures
(`commands` → `policy.gestureModes`). `mediapipe` ships in the image and the 8 MB model is
baked at `/opt/vision-models/gesture_recognizer.task` (`config.resolve_gesture_model()`: env
`VISION_GESTURE_MODEL` → `models/` → the baked copy). When either is missing, the feed names
the cause and the path it looked for, and runs unchanged. To ask it directly:

```sh
docker compose exec vision-feed python -c "from pipeline.gesture import GestureDetector as G; d=G(); print(d.unavailable_reason() or 'gestures ready')"
```

**The recognizer rides neither the motion gate nor a schedule of its own: it is asked on
every frame the loop reads.**

- The gate is the wrong question to ask about a hand. Measured at 1080p, one gate cell
  covers **240×180 px** and needs 40% of its pixels changed by >25 gray levels, while a hand
  at 1.5 m changes ~7% of a cell — so a hand can never trip it. Worse, a hand *held* still is
  absorbed into the gate's background in ~2-4 s, i.e. exactly when the model becomes
  confident.
- A schedule is the wrong answer for a second, measured reason: MediaPipe's `VIDEO` mode
  carries a palm detector and a landmark tracker across calls, so a sparse cadence does not
  delay its answer, it destroys it. On a held sign, 1/s samples answered `hand=True hits=[]`
  **every time**, while the same frames at the loop's own rate answered `Victory 0.50-0.71`
  over 24 consecutive frames — and the identical model re-run offline over those recorded
  frames classified the sign the same way.
- Rationing it was rationing the cheapest tier anyway: the recognizer costs **24.7 ms/frame**
  against the detector's **156 ms** (~12% of one core at 5/s, where the detector spends
  ~78%). So there is no rate knob: `GestureGate` (one event per name per
  `VISION_GESTURE_COOLDOWN_S`) is what keeps a wave from flooding the bus.

The recognizer's "no gesture" category (`None`, the model's own first label, which scores
high on a relaxed hand) is dropped, so a `gesture` event always names a gesture.

**The vocabulary is a table, not a constant** (`gestures.json` → `pipeline/gesture_vocab.py`),
and every name is owned by exactly one **source**:

| Source | What it is | Names |
| --- | --- | --- |
| `model` | a category of the canned bundle | `Closed_Fist`, `Open_Palm`, `Pointing_Up`, `Thumb_Down`, `Thumb_Up`, `Victory`, `ILoveYou` (shipped **disabled** — it fires on a relaxed hand) |
| `rules` | a geometric predicate over the 21 landmarks (`pipeline/gesture_rules.py`) | `Stop` (spread) / `Five` (together), `Four`, `Three`, `OK`, `Pinch`, `Point_Left/Right/Down`, `Thumbs_Sideways`, `Rock`, `Call_Me` |
| `motion` | a trajectory over those same landmarks (`pipeline/gesture_motion.py`) | `Swipe_Left/Right/Up/Down`, `Wave`, `Push`, `Pull` |
| `custom` | a category of a **trained** classifier (`train_gestures.py`), merged into the stock bundle | none by default |

The rules and the motion tier are arithmetic on `hand_landmarks` — computed by the same call
the categories come from, and previously thrown away — so the wider vocabulary costs **no
extra inference**. Only `custom` is an artifact, and it is additive: delete the file and the
canned vocabulary is exactly as it was. The table closes the vocabulary in both directions:
the enabled `model` names are the recognizer's `allow_list`, and a name no row declares is
dropped on the way out.

Two deliberate choices in the rules:

- They never **shadow** what the model already names (a raised index is `Pointing_Up`,
  index+middle is `Victory`, a vertical thumb is `Thumb_Up`/`Thumb_Down`): `None` from a rule
  means "the canned label stands".
- A hand yields **at most one** rule name — an ordered partition, first match wins — because
  two names for one hand would make the vote flicker between them. And `Stop` vs `Five` is
  **spread vs closed fingers**, never "is the palm facing the camera": MediaPipe's
  `handedness` is defined for a *mirrored* image and its z is wrist-relative, so a
  palm-normal test needs calibration, while the spread test is exact on the image plane.

**A gesture is a vote, not a score** (`pipeline/gesture.py#GestureVote`).
`VISION_GESTURE_MIN_SCORE` (0.35) is only a floor on what counts as an answer — the model's
score is not a classifier, and a held `Victory` measured **0.50-0.71** across 24 consecutive
frames, so the old 0.5 threshold dropped about half the frames of a sign held right in front
of the camera. Then `VISION_GESTURE_VOTE_NEED` of the last `VISION_GESTURE_VOTE_WINDOW`
frames (3 of 5) must agree on the same name: a floor low enough to see a held sign is low
enough to publish a hand crossing the frame, and the majority is what makes the sign
deliberate. It fires once per run of frames, and the cooldown de-duplicates a sign held
longer still.

**A trajectory is not voted on.** The motion tier fires once and *consumes* its window
(one swipe is one event, not a state), so "3 of the last 5 frames agree" can never be
satisfied by it: with the vote applied, every `Swipe_*` / `Wave` / `Push` / `Pull` was
measured at 1 of 5 and silently dropped, while the static signs published fine. Those
hits carry `confirmed=True` (`GestureHit.confirmed`) and go out on the frame they fire —
the trajectory's own requirements (`VISION_GESTURE_MOTION_MIN_SAMPLES` samples, a
travel of `VISION_GESTURE_MOTION_MIN_TRAVEL` in units of the palm's own width, inside
`VISION_GESTURE_MOTION_WINDOW_S`) are its confirmation, and the cooldown is what
de-duplicates a repeated sign. A hand MediaPipe misses for one frame keeps its
trajectory (`MotionTracker.forget(hands, now)`); one gone for longer than the window
loses it. Those four thresholds are all editable from the debug page (`mvt: fenêtre`,
`mvt: course`, `mvt: échantillons`, `mvt: amplitude vague`), because a swipe threshold
is a fact about *your* camera and hand. The trace keeps the two tiers apart, too:
`tracked=1 rules=- motion=Swipe_Left` is the whole diagnosis of a movement that the
vote or the cooldown swallowed.

### Recording, probing, training

Three dev tools, no service:

```sh
docker compose exec vision-feed python recorder.py --label Stop --seconds 20
docker compose exec vision-feed python probe_gestures.py             # what it measures
docker compose exec vision-feed python probe_gestures.py --replay    # what the model calls it
.venv-train/bin/python train_gestures.py --dataset dataset --out models
```

- `recorder.py` writes **two** artifacts per kept frame into `dataset/` (gitignored, local,
  never baked into an image): the padded hand crop (`<label>/<stamp>_<n>.jpg`) that Model
  Maker learns from, and the landmarks (`landmarks.jsonl`) the thresholds are calibrated
  against — plus what the model itself called the frame. `none` is a required label: the
  trained classifier needs a negative class.
- `probe_gestures.py` prints, per label, the measured range of every feature the rules
  threshold (`reach ≥ 1.5` extended, `contact ≤ 0.40` a pinch, `gaps ≥ 0.45` a spread hand)
  plus a `motion` line — the label's samples replayed through `gesture_motion.py` in time
  order, which is the only real measurement a swipe/wave/push threshold ever gets. With
  `--replay` it also runs the recognizer over the saved crops in **image** mode (offline, no
  camera) and reports the top category and the `no-hand` count — a tight crop is the classic
  reason a dataset trains and the model then sees nothing.
- `train_gestures.py` is a **build tool in its own venv** (`requirements-train.txt`:
  `mediapipe-model-maker` pins `tensorflow<2.16`, which has no Python 3.12 wheels). Its
  shippable artifact is the **bundle**: run it with `--export-bundle`, which writes
  `models/gesture_recognizer.task` for `VISION_GESTURE_MODEL` (plus `gesture_labels.json`).
  The mediapipe the feed ships exposes **no model path on `ClassifierOptions`**, so a second
  classifier cannot be merged into the stock bundle: the lone `gesture_classifier.tflite` is
  kept for tooling only, and a copy dropped in `models/` is skipped with a named note
  (`pipeline/gesture.py`) instead of taking the tier down. With the bundle in place its
  labels are declared in `gestures.json` as `model` rows (its label set replaces the canned
  one) — the script prints the rows to paste, and `recorder.py` warns when a label has no
  row yet.

## Why the counts are stable (the presence rules)

The churn this fixes was real, and visible in the activity log: **422 `enter` / 418 `leave`
for one person standing in front of the camera**, pairs landing 17 ms apart.

- The tracker returns its **live set**: the tracks the detector confirmed this frame *and*
  the ones it missed but still believes in (`matched=False`). On a frame the detector did not
  run on, the loop tells the policy **`None`** — "nobody looked" — never `[]`, which means
  "looked and saw nobody". A reported `leave` retires the id, so it is never reused.
- **Two windows, one id.** `VISION_MISS_TTL_S` (2 s) is the strict window: a detection
  continues the track only if it overlaps the last box. `VISION_TRACK_GRACE_S` (6 s) is the
  **re-association** window: a detection that no longer overlaps but is in the same place
  (same class, compatible *scale*, centre close to the box) **revives the id** instead of
  minting a new one, and the id is only dropped — with its `leave` — at the end of it. The
  strict rule alone minted a new id whenever a box jumped (someone sitting down, the detector
  snapping from a partial to a full-body box, a fast walk). The size test compares the
  **larger dimension**, not each side: measured live, walking away collapsed a person's box
  width from 1341 px to 780 px while the height barely moved (809 → 860 px). The price is
  that a real departure is reported up to `VISION_TRACK_GRACE_S` late — lower it (2 = the old
  behaviour) for an automation that needs a fast `leave`.
- **An `enter` lands on the first confirmed look** (`VISION_ENTER_CONFIRM_LOOKS`, 1). It was
  2 in the first cut of this fix, and the live trace is what changed it: the detector reports
  a person who is still in single-frame bursts, so the trace sat on `pending #1:1` for 15+
  frames while the box was carried — a visit that was **never announced**, the opposite
  failure and the worse one. The knob is kept for a detector that reports ghosts: a track
  that never reaches the count is dropped in silence (no `leave` for a visit nobody was told
  about) and can never `dwell`, which needs a recent confirmation.
- **A quiet gate is looked at, not believed** (`pipeline/loop.py#look_fps`). A still person
  is absorbed into the gate's background in ~2-4 s, and the old rule answered that by
  *believing* the track present and never looking again — so a real departure in a silent
  room was reported only when the gate woke up on its own, which could be minutes, or never.
  `VISION_QUIET_DETECT_FPS` (1/s) asks the detector anyway while tracks are alive: a still
  person is re-confirmed, a departure is retired one TTL later. With no track alive the rate
  is 0, so an empty room costs nothing — and the rate is clamped to at least two looks per
  miss TTL, because a longer interval would retire a person standing still *between two
  looks* (the churn again).
- Escalation runs in `pipeline/poster.py`'s worker, so a VLM call can never stop the
  sampling either. A dead or desynced stream is reopened with a backoff bounded by
  `VISION_REOPEN_MIN_S` / `VISION_REOPEN_MAX_S` (0.2 → 2 s; the ladder used to run to 30 s,
  half a minute blind for a one-second hiccup) and **only the gate is rebuilt**
  (`main.py#_gate`): the tracker and the policy carry on, and `keep` freezes the tracks across
  the outage, so a hiccup neither mints a second `enter` for someone who stayed nor swallows
  the `leave` of someone who left during it. The brain poll is tri-state for the same reason
  (`brain.fetch_feeds` returns `None` when the brain does not answer, `[]` when it answers
  with no camera): an unreachable brain stops nothing, instead of tearing every feed down and
  re-paying each model load on the way back.

## Detector (ONNX Runtime)

The detector is an exported **YOLO26n ONNX** loaded by ONNX Runtime — **no torch at
runtime**. Produce the model once (on the host, or in the Dockerfile's builder stage):

```sh
python -m pip install -r requirements-export.txt   # ultralytics — dev/build only
python export.py --out models                      # → models/yolo26n.onnx + names
```

`config.resolve_yolo_model()` finds it (env `YOLO_MODEL` → `models/` → `/opt/vision-models/`,
baked into the image). The ONNX session tunes itself for the host CPU at load and caches the
optimized graph beside the model. Knobs: `VISION_FEED_THREADS` (**≤ physical cores** —
oversubscription is 2× slower), `VISION_FEED_ONNX_PROVIDERS` (`cpu`, or `openvino,cpu`),
`VISION_DETECT_IMGSZ`, `VISION_DETECT_CONF`.

## VLM escalation

When one of a camera's modes asks for escalation, an interesting event
(`enter`/`dwell`/`appear`/`gesture`) **of a class that mode watches** sends a keyframe to the
brain (`POST /api/vision/describe`). The brain describes it with the **fast VLM first**
(`smolvlm-500m`, GPU-offloaded) and falls back to the heavy Qwen3-VL only when the fast one
has nothing useful to say. The keyframe is stored (rotated, no video) and the description
rides on the event as `vlm.text`. On CPU the fast tier answers in **~1 s** against **~6.5 s**
for the heavy model, which is what makes escalating every interesting event affordable — and
it runs on `pipeline/poster.py`'s worker thread, never on the feed loop, because a call that
long inline made the camera deaf for its whole duration (right after a gesture, which is when
the next wave arrives).

## On-demand questions (the agent's tools)

The agent looks at a camera when asked, through the `camera` MCP tools (`fetch-camera-list`,
`describe-camera`, `add-camera-items-to-shopping`). An HA or MJPEG camera is snapshotted over
HTTP; a webcam / RTSP camera needs a live feed (the tool says so). The grocery tool asks the
VLM for a JSON item list and feeds it through the ordinary shopping ingestion (raw first,
structured later).

## Layout

| File | Responsibility |
| --- | --- |
| `pipeline/gate.py` | Tier 0 motion (pure numpy, unit-tested) |
| `pipeline/detect.py` | Tier 1 YOLO26n (**ONNX Runtime**, no torch) |
| `pipeline/postprocess.py` | letterbox + box decode + NMS (pure, unit-tested) |
| `pipeline/track.py` | Tier 2 IoU tracker (no dependency; the **live set** — matched + carried, `keep`/`forget`) |
| `pipeline/policy.py` | tracks → semantic events (pure, unit-tested; `None` = the detector did not look, a `dwell` needs evidence within the TTL) |
| `pipeline/loop.py` | the loop's cadence rules — detector, quiet-gate watchdog, presence, gestures, feed poll (pure, unit-tested) |
| `pipeline/observe.py` | per-frame stats + counters + the drawing/encoding used by the trace **and** the debug UI (one instrumentation path) |
| `pipeline/poster.py` | posts events off the loop thread (escalation included) |
| `pipeline/sources.py` | frame sources: webcam / rtsp / mjpeg (JPEG-marker reader, no ffmpeg demuxer) / ha / echo |
| `pipeline/escalate.py` | keyframe → brain describe (fast → heavy VLM) |
| `pipeline/gesture.py` | MediaPipe gestures: the recognizer, the vote, the gate (loaded when a mode asks for them; model baked at `/opt/vision-models`) |
| `pipeline/gesture_vocab.py` | the closed vocabulary table (`gestures.json` → names + sources, `allow_list`, per-name floors) |
| `pipeline/hands.py` | the 21 landmarks → scale-invariant features (pure; the numbers the probe calibrates) |
| `pipeline/gesture_rules.py` | the static rules: one name per hand, first match wins (pure) |
| `pipeline/gesture_motion.py` | swipe / wave / push-pull from a palm trajectory (pure) |
| `pipeline/gesture_dataset.py` | the recorded dataset: crop geometry, ledger, per-label summary (pure) |
| `recorder.py` | record samples — crop + landmarks + what the model called it (`dataset/`) |
| `probe_gestures.py` | what the recorded signs measure, and (`--replay`) what the model calls them |
| `train_gestures.py` | train the custom classifier (build tool; `requirements-train.txt`) |
| `gestures.json` | the vocabulary itself — mounted, editable without a rebuild |
| `main.py` | runner: a live source on a laptop (`--source`) or the brain's feeds (`--brain`; the `sink`/`observer` hooks the UI uses) |
| `debug.py` | the local debug UI: live annotated MJPEG + counters + timeline, against a mocked brain |
| `mock_brain.py` | the stub brain (feed list + event sink, same shapes as `cameras/modes.ts` resolves) |
| `static/debug.html` | the page (no build step) |
| `bench.py` | tier benchmark on real frames |
| `export.py` | YOLO26n → ONNX (build/dev only; `requirements-export.txt`) |
| `config.py` | every knob, env-overridable |

## Tests

```sh
cd vision-feed
python -m pytest        # gate, policy, postprocess, sources, gestures (vocab / rules /
                        # motion / dataset), config, brain, observe, mock_brain, debug,
                        # cascade — no model and no torch needed
# in the container:
docker compose exec vision-feed python -m pytest
```

