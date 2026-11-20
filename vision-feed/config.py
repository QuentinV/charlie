"""Configuration of the vision-feed service.

Every value is an environment override with a sane default, so the same code
runs in the laptop PoC (`python main.py --source webcam`) and in the container
(`docker-compose.yml`) without a change.
"""
import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ[name])
    except (KeyError, ValueError):
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ[name])
    except (KeyError, ValueError):
        return default


# --- Brain ---
BRAIN_URL = os.environ.get('BRAIN_URL', 'http://api:9300')
# The brain mints a service token at boot and writes it here
# (nodejs-apis/src/auth/serviceToken.ts). Read per call, so it self-heals.
BRAIN_TOKEN_FILE = os.environ.get(
    'BRAIN_TOKEN_FILE', '/app/.private/vision-feed.token'
)
# Also look next to the repo checkout (the laptop PoC runs from vision-feed/).
BRAIN_TOKEN_FILE_FALLBACK = '../nodejs-apis/.private/vision-feed.token'
FEED_POLL_S = _float('VISION_FEED_POLL_S', 5.0)


def brain_token() -> str:
    """The API token the brain wrote to disk.

    Read on every call, so a token written after this process started is picked
    up on the next poll — no restart.
    """
    for path in (BRAIN_TOKEN_FILE, BRAIN_TOKEN_FILE_FALLBACK):
        try:
            with open(path, encoding='utf-8') as handle:
                value = handle.read().strip()
            if value:
                return value
        except OSError:
            continue
    return ''

# --- Debug trace ---
# One line a second with what the cascade actually saw: the gate's verdict, the
# detections, the track ids with their `matched` flag, the recognizer's **raw** answer
# (below the floor included) and the events. Off by default — the feed logs errors
# only. `debug.py` (the local UI with live boxes) draws the same `pipeline.observe`
# stats, so the trace and the UI can never disagree about what happened.
DEBUG = _int('VISION_DEBUG', 0)

# --- Tier 0: motion gate ---
GATE_WIDTH = _int('VISION_GATE_WIDTH', 160)
GATE_HEIGHT = _int('VISION_GATE_HEIGHT', 120)
GATE_THRESHOLD = _int('VISION_GATE_THRESHOLD', 25)  # 0-255 pixel diff
GATE_CELL_MIN = _float('VISION_GATE_CELL_MIN', 0.40)  # per-cell changed ratio
GATE_MAX_HOT_FRACTION = _float('VISION_GATE_MAX_HOT_FRACTION', 0.5)
GATE_WARMUP = _int('VISION_GATE_WARMUP', 5)

# --- Tier 1: detector (ONNX Runtime) ---
# The model is an exported YOLO26n ONNX (see export.py); `resolve_yolo_model()`
# picks the first one that exists (env → models/ → the image's baked copy).
YOLO_MODEL = os.environ.get('YOLO_MODEL')
DETECT_CONF = _float('VISION_DETECT_CONF', 0.35)
DETECT_IMGSZ = _int('VISION_DETECT_IMGSZ', 640)
NMS_IOU = _float('VISION_FEED_NMS_IOU', 0.45)
# ONNX Runtime thread cap — the "pinning" (a container cpuset is the real one).
DETECT_THREADS = _int('VISION_FEED_THREADS', 2)
# Execution providers, in order: `cpu` (default) or e.g. `openvino,cpu`.
ONNX_PROVIDERS = os.environ.get('VISION_FEED_ONNX_PROVIDERS', 'cpu')

MODEL_DIR = os.environ.get('VISION_MODEL_DIR', 'models')
BAKED_MODEL_DIR = '/opt/vision-models'


def resolve_yolo_model() -> str:
    """First existing ONNX model: env → `models/` → the image's baked copy."""
    candidates = [
        YOLO_MODEL,
        os.path.join(MODEL_DIR, 'yolo26n.onnx'),
        os.path.join(BAKED_MODEL_DIR, 'yolo26n.onnx'),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return os.path.join(MODEL_DIR, 'yolo26n.onnx')


def resolve_names(model_path: str):
    """The class-names JSON beside the model, else the baked one; None if absent."""
    base = os.path.splitext(model_path)[0]
    for path in (
        base + '.names.json',
        os.path.join(BAKED_MODEL_DIR, 'yolo26n.names.json'),
        os.path.join(MODEL_DIR, 'yolo26n.names.json'),
    ):
        if os.path.exists(path):
            return path
    return None


def load_class_names(model_path: str) -> dict:
    """`{class_id: name}` from the sidecar JSON (empty when it is missing)."""
    import json

    path = resolve_names(model_path)
    if not path:
        return {}
    with open(path, encoding='utf-8') as handle:
        data = json.load(handle)
    if isinstance(data, list):
        return {index: name for index, name in enumerate(data)}
    return {int(k): v for k, v in data.items()}


def onnx_providers() -> list:
    """Execution providers, filtered to those this ONNX Runtime build has."""
    wanted = [p.strip().lower() for p in ONNX_PROVIDERS.split(',') if p.strip()]
    alias = {'cpu': 'CPUExecutionProvider', 'openvino': 'OpenVINOExecutionProvider'}
    try:
        import onnxruntime as ort

        available = set(ort.get_available_providers())
    except Exception:
        return ['CPUExecutionProvider']
    providers = [alias[w] for w in wanted if alias.get(w) in available]
    return providers or ['CPUExecutionProvider']

# --- Tier 2: tracking / policy ---
DWELL_S = _float('VISION_DWELL_S', 15.0)
# How long a track survives without a detection before it has left, **shared by
# the tracker and the policy** (one number, so the id is retired exactly when the
# `leave` is reported). It was 1.0 s, which is the same as the interval between two
# detections at the 5/s cadence: one blink of the detector, and the track was gone
# and re-minted — an `enter`/`leave` pair per cycle while the person never moved.
# 2.0 s absorbs a 1-2 s blink (and a gate that goes quiet on a still person); a real
# departure is reported at most 2 s late.
MISS_TTL_S = _float('VISION_MISS_TTL_S', 2.0)

# The **re-association** window: how long an id survives a miss before it is retired —
# i.e. before the policy is allowed to report its `leave`. Two windows, one id:
#
#  - `MISS_TTL_S` (2 s) is the *strict* window: a detection counts as the same track
#    only if it overlaps the last known box (`IouTracker.iou_min`), and it is the
#    evidence window the policy needs for a `dwell`;
#  - `TRACK_GRACE_S` (6 s) is the *re-association* window: a detection that no longer
#    overlaps but is in the same place (same class, compatible size, centre within the
#    box) **revives the id** instead of minting a new one, and the id is only dropped —
#    with the `leave` — at the end of it.
#
# Without it, a box that jumps (someone sitting down, a detector that blinks for more
# than the TTL, a person who walks out of frame and back) minted a new id while the old
# one was still carried: the live log showed 422 `enter` / 418 `leave` for a single
# person standing in front of the camera, with the pair landing **17 ms** apart. The
# cost is that a real departure is reported up to `TRACK_GRACE_S` late — a lower value
# (2 = the old behaviour) buys a fast `leave` and pays for it in churn.
TRACK_GRACE_S = _float('VISION_TRACK_GRACE_S', 6.0)
# Re-association tolerance: two boxes of the same class are "in the same place" when
# their centres are within `centre_frac` of the larger box and their **scale** — the
# larger of the two dimensions, the one that survives a person walking away, measured
# live — agrees to `size_frac`. Loose enough for a person sitting down or a detector
# whose box snaps from partial to full body, tight enough that a box three times the
# size is a different thing.
TRACK_CENTRE_FRAC = _float('VISION_TRACK_CENTRE_FRAC', 0.6)
TRACK_SIZE_FRAC = _float('VISION_TRACK_SIZE_FRAC', 0.3)

# How many **confirmed** frames a track needs before it is worth an `enter`. `1` (the
# default) means the first look, and it is what the live trace said to ship: at 1080p the
# detector reports a person who is still in single-frame bursts, so a `2` left the trace
# stuck on `pending #1:1` for 15+ frames (`det=yes`, the box carried) and the visit was
# **never announced** — the opposite failure of churn, and the worse one: an `enter` is
# what the whole feature exists for. The ghost it would have filtered costs one `enter`
# and one `leave` a grace window later (never a `dwell`, which needs a recent
# confirmation), and the box-jump churn that mattered is the tracker's job
# (`TRACK_GRACE_S`). Kept as a knob for a camera whose detector is noisy.
ENTER_CONFIRM_LOOKS = _int('VISION_ENTER_CONFIRM_LOOKS', 1)

# --- Loop ---
# Sampling rate: how often a frame is read and the motion gate is asked.
IDLE_FPS = _float('VISION_FEED_FPS', 2.0)
# Detection cadence *inside a motion burst*: how often the detector may run. The
# gesture tier rides the same burst but not this cadence (see `main.run_feed`).
# This used to be a cooldown in milliseconds (`VISION_FEED_COOLDOWN_MS`, 2000 ms)
# which starved gestures: the recognizer was asked once every 2 s, so a wave was
# usually over before the next evaluation — measured 0.5 evaluations/s and a mean
# wait of 1000 ms, for a recognizer that costs 44 ms/frame. Still honoured, for a
# deployment that set it.
_LEGACY_COOLDOWN_MS = _int('VISION_FEED_COOLDOWN_MS', 0)
DETECT_FPS = _float(
    'VISION_FEED_DETECT_FPS',
    1000.0 / _LEGACY_COOLDOWN_MS if _LEGACY_COOLDOWN_MS > 0 else 5.0,
)


def _watchdog_fps(configured: float, miss_ttl_s: float) -> float:
    """The quiet-gate detection rate, never slow enough to outlive the miss TTL.

    The invariant is **at least two looks per TTL**: an interval longer than
    `miss_ttl_s` would retire a person standing still *between two looks* — a new id
    and a phantom `enter`, which is exactly the churn this rate exists to prevent. A
    deployment that asks for something slower gets the fastest safe rate instead.
    """
    if miss_ttl_s <= 0:
        return configured
    return max(configured, 2.0 / miss_ttl_s)


# Detection cadence while the motion gate is **quiet but tracks are alive** (see
# `loop.look_fps`): a watchdog, not a schedule. A person standing still is absorbed
# into the gate's background in ~2-4 s, so a quiet gate is not evidence of an empty
# room — but *believing* them present without ever looking (`track.keep`) meant a real
# departure in a silent room could never be reported at all, which is what delayed
# every `leave`. One look per second is evidence: a still person is re-confirmed and a
# departure is reported one TTL later. With no track alive there is nothing to
# confirm, so the rate is 0 and an empty room stays idle.
QUIET_DETECT_FPS = _watchdog_fps(_float('VISION_QUIET_DETECT_FPS', 1.0), MISS_TTL_S)

# --- Stream reopen ---
# Backoff bounds (seconds) for a source that died or desynced: the wait doubles from
# MIN to MAX while it refuses to open. A relayed MJPEG stream (the brain's
# passthrough) or a loopback webcam helper is back in milliseconds, so the cap has to
# be small — the old ladder ran to 30 s, which turned a one-second hiccup into half a
# minute of blindness, and the cascade was dropped whole on top of it.
REOPEN_MIN_S = _float('VISION_REOPEN_MIN_S', 0.2)
REOPEN_MAX_S = _float('VISION_REOPEN_MAX_S', 2.0)

# --- Tier 3: escalation ---
# Event kinds that trigger a VLM description (only for a class whose modes ask
# for escalation: `policy.escalateClasses`). Escalating is rare, so it never runs
# on every event.
ESCALATE_KINDS = tuple(
    k.strip()
    for k in os.environ.get(
        'VISION_ESCALATE_KINDS', 'enter,dwell,appear,gesture'
    ).split(',')
    if k.strip()
)
DESCRIBE_PROMPT = os.environ.get(
    'VISION_DESCRIBE_PROMPT',
    'Décris en une phrase ce qui se passe sur cette image de caméra '
    '(personnes, animaux, objets).',
)

# --- Tier 3 (cheap): gestures ---
# Loaded per camera, only when a selected mode asks for gestures (the `commands`
# mode): `policy.gestureModes`. `mediapipe` ships in the image and the `.task`
# model is baked at /opt/vision-models; `resolve_gesture_model()` picks the first
# one that exists (env → models/ → the baked copy), like the detector's. When
# either is missing the feed names the cause and runs unchanged.
#
# The recognizer is **not** gated on the motion gate, and it is **not on a schedule
# either**: it is asked on every frame the loop reads (`main.py`). The gate is the
# wrong question to ask about a hand — one 240x180 px cell at 1080p needs >25 gray
# levels of change over 40% of its pixels while a hand at 1.5 m changes ~7% of a
# cell, and a hand held still is absorbed into the gate's background in ~2-4 s, i.e.
# exactly when the model becomes confident. A sparse cadence is worse than a late
# one: the recognizer's `VIDEO` mode tracks the hand across calls, so at 1/s it
# reported a hand and no gesture *every time* (measured live on a held sign), while
# the same frames at the loop's own 5/s classified it (`Victory 0.50-0.71`). It is
# also the cheapest tier of the cascade: 24.7 ms/frame against the detector's
# 156 ms, i.e. ~12% of one core at 5/s. There is therefore no rate knob —
# `GESTURE_COOLDOWN_S` is what de-duplicates a held sign.
GESTURE_MODEL = os.environ.get('VISION_GESTURE_MODEL')
# The **trained** classifier (`train_gestures.py`) — usable only as a **bundle**
# (`--export-bundle` → `VISION_GESTURE_MODEL`), because the mediapipe we ship exposes no
# model path on `ClassifierOptions` for a *second* classifier. A lone
# `gesture_classifier.tflite` is skipped (`pipeline/gesture.py` records why in `note`).
# Absent is the normal state (the `custom` rows of the vocabulary simply never fire).
GESTURE_CLASSIFIER = os.environ.get('VISION_GESTURE_CLASSIFIER')
# The per-frame floor. It is **not** the decision any more (the vote below is): the
# model's own score is not a classifier — a held `Victory` measured 0.50-0.71 over 24
# consecutive frames, so the old 0.5 threshold dropped about half of the frames of a
# sign the user was holding right in front of the camera. 0.35 is a floor that keeps a
# plausible answer and lets the vote do the deciding.
GESTURE_MIN_SCORE = _float('VISION_GESTURE_MIN_SCORE', 0.35)
GESTURE_COOLDOWN_S = _float('VISION_GESTURE_COOLDOWN_S', 3.0)
# The vote: `NEED` of the last `WINDOW` recognizer answers must agree on the same name
# before it is published. A floor alone cannot do both jobs — low enough to see a held
# sign is low enough to publish a hand passing through the frame — while a majority of
# consecutive frames is what makes the sign *deliberate*: held for ~0.6 s at the loop's
# 5/s, and never fired by one ambiguous frame. `window=1, need=1` disables it.
GESTURE_VOTE_WINDOW = _int('VISION_GESTURE_VOTE_WINDOW', 5)
GESTURE_VOTE_NEED = _int('VISION_GESTURE_VOTE_NEED', 3)

# --- Gesture vocabulary (the closed list of names) ---
# `gestures.json` declares every name a `gesture` event may carry and the source that
# owns it (`model` / `custom` / `rules` / `motion` — see `pipeline/gesture_vocab.py`).
# Mounted, so the vocabulary is editable without rebuilding the image; when no file is
# found the built-in `DEFAULT_VOCABULARY` (the same rows, pinned by a test) runs instead
# of no gestures at all. A file that **is** there and does not validate raises, and the
# tier names the bad row at startup: a vocabulary is a contract, and publishing a name
# nobody declared is worse than publishing nothing.
GESTURE_TABLE = os.environ.get('VISION_GESTURES_TABLE')
GESTURE_TABLE_FALLBACK = '/app/gestures.json'
# The score a matched **rule** reports (the table overrides it per name). It is not
# comparable with the recognizer's probability — the number only orders one frame's vote,
# and a matched predicate deliberately outranks a canned category on the same pose
# (`OK` over the `Closed_Fist` a pinch triggers, `Stop` over `Open_Palm`).
GESTURE_RULE_SCORE = _float('VISION_GESTURE_RULE_SCORE', 0.9)
# The static rules (`pipeline/gesture_rules.py`) and the motion tier
# (`pipeline/gesture_motion.py`). Both are pure arithmetic on landmarks the recognizer
# already returned, so they cost ~0 ms; the switches exist for a deployment that wants
# the canned vocabulary alone.
GESTURE_RULES = _int('VISION_GESTURE_RULES', 1)
GESTURE_MOTION = _int('VISION_GESTURE_MOTION', 1)

# --- The recognizer's hand options ---
# MediaPipe's defaults are tuned for one hand at selfie distance: `num_hands=1`, and 0.5
# confidence on detection / presence / tracking. Two hands are needed for a two-hand
# sign, and 0.5 drops a hand held 2-3 m from a ceiling camera — where the sign is then
# simply never seen, with no error anywhere. Both are knobs because they trade CPU
# (`num_hands=2` runs the palm detector more often) for reach.
GESTURE_NUM_HANDS = _int('VISION_GESTURE_NUM_HANDS', 2)
GESTURE_HAND_DETECTION_CONFIDENCE = _float(
    'VISION_GESTURE_HAND_DETECTION_CONFIDENCE', 0.4
)
GESTURE_HAND_PRESENCE_CONFIDENCE = _float(
    'VISION_GESTURE_HAND_PRESENCE_CONFIDENCE', 0.4
)
GESTURE_HAND_TRACKING_CONFIDENCE = _float(
    'VISION_GESTURE_HAND_TRACKING_CONFIDENCE', 0.5
)

# --- Motion tier (`pipeline/gesture_motion.py`) ---
# The window a trajectory has to fit inside, and the travel (in palm scales) that makes
# a displacement a swipe rather than a wobble. Both are calibrated on recorded frames
# (`recorder.py` + `probe_gestures.py`); the two remaining thresholds (`MIN_STRAIGHT`,
# the wave amplitude) are module constants, because they are properties of the *shape*
# of a gesture rather than of a camera.
GESTURE_MOTION_WINDOW_S = _float('VISION_GESTURE_MOTION_WINDOW_S', 0.8)
GESTURE_MOTION_MIN_TRAVEL = _float('VISION_GESTURE_MOTION_MIN_TRAVEL', 1.5)
GESTURE_MOTION_MIN_SAMPLES = _int('VISION_GESTURE_MOTION_MIN_SAMPLES', 4)
GESTURE_MOTION_WAVE_AMPLITUDE = _float(
    'VISION_GESTURE_MOTION_WAVE_AMPLITUDE', 0.8
)


def resolve_gesture_model() -> str:
    """First existing gesture model: env → `models/` → the image's baked copy."""
    candidates = [
        GESTURE_MODEL,
        os.path.join(MODEL_DIR, 'gesture_recognizer.task'),
        os.path.join(BAKED_MODEL_DIR, 'gesture_recognizer.task'),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return os.path.join(MODEL_DIR, 'gesture_recognizer.task')


def resolve_gesture_table() -> str:
    """First existing vocabulary table, or '' when there is none (built-in default)."""
    candidates = [
        GESTURE_TABLE,
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gestures.json'),
        GESTURE_TABLE_FALLBACK,
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return ''


_GESTURES = None


def load_gestures():
    """The gesture vocabulary: the mounted table, else the built-in default.

    Read **once** — the vocabulary is a contract, not a per-frame input. A file that
    exists but does not validate raises `ValueError` naming the row, and
    `GestureDetector._probe` turns that into one startup line with the tier off: better a
    camera that says why it has no gestures than one that publishes names nobody
    declared.
    """
    global _GESTURES
    if _GESTURES is None:
        from pipeline import gesture_vocab

        path = resolve_gesture_table()
        _GESTURES = (
            gesture_vocab.load(path) if path else gesture_vocab.DEFAULT_VOCABULARY
        )
    return _GESTURES


def resolve_gesture_classifier() -> str:
    """First existing **trained** classifier: env → `models/` → the image's copy, else ''.

    Absent is the normal state and not an error: the canned categories keep working and
    the table's `custom` rows simply never fire. `train_gestures.py` writes the artifact
    here — but on the mediapipe the feed ships (`ClassifierOptions` carries no model path)
    a lone `.tflite` cannot be *merged* in: `pipeline/gesture.py` finds it, refuses it and
    records why in `note`, while the **bundle** is what serves trained labels
    (`--export-bundle` → `VISION_GESTURE_MODEL`). Locating it here is still the right
    thing to do — the skip is reported once, at startup, naming this path.
    """
    candidates = [
        GESTURE_CLASSIFIER,
        os.path.join(MODEL_DIR, 'gesture_classifier.tflite'),
        os.path.join(BAKED_MODEL_DIR, 'gesture_classifier.tflite'),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return ''
