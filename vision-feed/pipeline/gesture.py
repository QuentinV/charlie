"""Tier 3 (cheap) — hand gestures, via MediaPipe's Gesture Recognizer.

The recognizer is asked on **every frame** the feed loop reads (`main.py`), never on
the motion gate and never on a schedule of its own. The gate is the wrong question
to ask about a hand: measured on a 1080p camera, a hand cannot change 40% of a
240x180 px gate cell, and the gate goes quiet on a hand *held* still — exactly when
the model becomes confident. A schedule is the wrong answer for a different reason:
the recognizer's `VIDEO` mode carries a landmark tracker across calls, so sampling it
once a second made it report a hand and no gesture *every time* (measured live on a
held sign), where the same frames at the loop's own cadence classified it
(`Victory 0.50-0.71`). It is also the cheapest tier of the cascade (24.7 ms/frame
against the detector's 156 ms), and `GestureGate` — not the sampling rate — is what
keeps a wave from flooding the bus.

`mediapipe` ships in the image and the model is baked
(`config.resolve_gesture_model()`); when either is missing the pipeline runs
unchanged, it simply never emits `gesture` events — `available()` is False and
`unavailable_reason()` names the cause.

The **vocabulary** is a table (`gestures.json` → `pipeline/gesture_vocab.py`), not a
constant: the canned categories, the geometric rules (`pipeline/gesture_rules.py`) and
the motion trajectories (`pipeline/gesture_motion.py`) all feed the same vote, and a name
no row declares is dropped on the way out. The rules and the motion tier are arithmetic
on the hand landmarks the recognizer returns **anyway** — `hand_landmarks` was already
computed and thrown away — so the added vocabulary costs ~0 ms. The canned set is closed
at the source (`category_allowlist`), and the trained classifier (`train_gestures.py`) is
the only artifact — reached as a **bundle** (`--export-bundle` → `VISION_GESTURE_MODEL`):
the mediapipe we ship has no model path on `ClassifierOptions` for a *second* classifier,
so a standalone `.tflite` is skipped with the reason recorded (`note`) instead of taking
the whole tier down with a `TypeError`.

The **decision** is a vote, not a score. `GestureDetector.min_score` (0.35) is only a
floor on what counts as an answer, because the model's score is not a classifier: a
held `Victory` measured 0.50-0.71 across 24 consecutive frames, so the old 0.5
threshold dropped about half the frames of a sign the user was holding right in front
of the camera. `GestureVote` then requires `need` of the last `window` frames to agree
on the same name — a floor low enough to see a held sign is low enough to publish a
hand passing through frame, and the majority is what makes the sign deliberate. What
keeps a *held* sign from flooding the bus is `GestureGate` (one event per name per
cooldown), never the sampling rate.
"""
import time
from dataclasses import dataclass

import config
from pipeline import gesture_motion, gesture_rules
from pipeline.hands import hands_from_result

#: MediaPipe's "no gesture" category. It is a real label of the shipped model — the
#: first entry of its label map, ahead of `Closed_Fist` — and it scores *high* on a
#: neutral or open hand, so without this filter a relaxed hand publishes
#: `gesture None` events.
NO_GESTURE = 'none'


@dataclass
class GestureHit:
    """One name a frame produced, and how far it may be trusted.

    `score` only orders one frame's candidates ("the strongest answer of the frame") and
    is what the trace displays; for the geometric and motion tiers it is not a
    probability at all.

    `confirmed` marks a hit that is **already the summary of a whole window** rather than
    a per-frame reading: a trajectory (`pipeline/gesture_motion.py`) needs its travel
    inside `GESTURE_MOTION_WINDOW_S` and is *consumed* when it fires, so it can be
    neither held nor repeated. `GestureVote` — which waits for a majority of consecutive
    frames — must therefore publish it on the frame it fires instead of voting on it.
    """

    name: str
    score: float
    confirmed: bool = False


def hits_from_gestures(gestures, min_score: float, allowed=None,
                       floors=None) -> list:
    """The hits a recognizer result carries, above the score threshold.

    Pure: takes the recognizer's `gestures` list (one list of categories per
    hand), so the threshold is testable without mediapipe. The "no gesture"
    category is dropped here — a `gesture` event must name a gesture.

    `allowed` is the vocabulary's closed set and `floors` its per-name overrides: a
    name the table does not declare is dropped (so a label a future bundle adds cannot
    reach the bus unannounced), and a trained label can require a higher score than a
    canned category without moving the global floor for everyone.
    """
    hits: list[GestureHit] = []
    for hand in gestures or []:
        top = hand[0] if hand else None
        if not top:
            continue
        name = (top.category_name or '').strip()
        if not name or name.lower() == NO_GESTURE:
            continue
        if allowed is not None and name not in allowed:
            continue
        floor = (floors or {}).get(name, min_score)
        if float(top.score) >= floor:
            hits.append(GestureHit(name, float(top.score)))
    return hits


class GestureGate:
    """One event per gesture name per cooldown (a wave must not flood the bus)."""

    def __init__(self, cooldown_s=None):
        self.cooldown_s = (
            config.GESTURE_COOLDOWN_S if cooldown_s is None else cooldown_s
        )
        self._last: dict[str, float] = {}

    def accept(self, hit: GestureHit, now: float) -> bool:
        """True when the hit is new enough to publish (and records it)."""
        last = self._last.get(hit.name)
        if last is not None and now - last < self.cooldown_s:
            return False
        self._last[hit.name] = now
        return True


def _raw_answer(gestures, hands=None, rules=None, motion=None) -> dict:
    """The recognizer's raw best answer, floor and `None` label included.

    For the trace and the debug UI: `hits_from_gestures` deliberately hides what it
    rejects, and "the model saw a hand and called it `None` at 0.97" is exactly the
    information a person debugging a sign needs.

    `hands` (the landmark-bearing hands) and `rules` (what the geometric and motion
    tiers spelled) are optional and only reported when the caller has them — the shape
    without them is the shape that was always there.

    `rules` and `motion` are reported **separately** because the two decide
    differently: a rule is a per-frame reading the vote has to confirm, a trajectory
    is a window summary that is already confirmed (`GestureHit.confirmed`).
    """
    hands_count = len(gestures or [])
    top_name, top_score = '', 0.0
    for hand in gestures or []:
        if not hand:
            continue
        best = hand[0]
        if best and float(best.score) > top_score:
            top_name = (best.category_name or '').strip()
            top_score = float(best.score)
    answer = {'hands': hands_count, 'top': top_name, 'score': round(top_score, 3)}
    if hands is not None:
        # How many hands the recognizer *tracked* — a hand it saw but could not name
        # (`None` at 0.97) is the first thing to look at when a sign does not fire.
        answer['landmarks'] = len(hands)
    if rules is not None:
        answer['rules'] = list(rules)
    if motion is not None:
        answer['motion'] = list(motion)
    return answer


class GestureVote:
    """N-of-M confirmation: a name is published once `need` of the last `window`
    frames agree on it.

    The recognizer's answer for a *held* sign flickers between the true label and
    `None` or a neighbour, and its score wanders (measured: `Victory 0.50-0.71` over 24
    consecutive frames). A per-frame threshold has to choose between missing the sign
    and publishing noise; a majority over consecutive frames does not: a sign is
    deliberate when it is **held**, which is what a user does in front of a camera,
    while one frame of a hand passing through the view can never reach `need`.

    Fires on the frame the run reaches `need` and not again while it holds (the
    cooldown gate de-duplicates a sign the user holds for longer still).
    """

    def __init__(self, window: int = None, need: int = None):
        configured = config.GESTURE_VOTE_WINDOW if window is None else window
        wanted = config.GESTURE_VOTE_NEED if need is None else need
        self.window = max(1, int(configured))
        # `need > window` would never be satisfied — a silent no-op gesture tier. Clamped
        # rather than trusted: the mistake is a knob, and a camera that ignores hands is
        # exactly the symptom this class exists to fix.
        self.need = min(max(1, int(wanted)), self.window)
        #: The last `window` frames' votes ('' = the frame saw no gesture).
        self._history: list[str] = []

    @property
    def history(self) -> list:
        """The window, oldest first — what the trace and the debug UI display."""
        return list(self._history)

    def observe(self, hits) -> list:
        """Feed one frame's hits; return the ones that reached the decision.

        Two kinds come in and they are decided differently:

        - a **per-frame** reading (the model's category, a geometric rule) is a
          score that flickers, so `need` of the last `window` frames must agree on it;
        - a **confirmed** hit (`GestureHit.confirmed`) is already the summary of a whole
          window: a trajectory that is *consumed* when it fires. Waiting for a majority
          of frames would drop every swipe (measured: `Swipe_Left` at 1 of 5, never
          published), so it goes out on the frame it fires and `GestureGate`'s cooldown
          is what de-duplicates a repeated sign.

        `hits` is `GestureDetector.detect`'s answer (already above the floor). A
        frame's vote is its **best** unconfirmed hit, so two hands holding different
        signs cannot split each other's count — and a trajectory never votes.
        """
        immediate = [hit for hit in (hits or ()) if hit.confirmed]
        votable = [hit for hit in (hits or ()) if not hit.confirmed]
        best = max(votable, key=lambda h: h.score) if votable else None
        name = best.name if best else ''
        self._history.append(name)
        if len(self._history) > self.window:
            self._history.pop(0)
        if not best:
            return immediate
        if self._history.count(name) < self.need:
            return immediate
        if self._history[:-1].count(name) >= self.need:
            return immediate  # already fired for this run of frames
        return immediate + [best]


def hits_for_frame(gestures, rules, motion, vocabulary, min_score) -> list:
    """One frame's hits, in the order `GestureVote` must see them.

    Pure (no recognizer, no landmarks), so the ordering and the `confirmed` flag are
    testable without mediapipe — and the flag is the whole fix: a trajectory is a
    window summary that is consumed when it fires, so a vote waiting for a majority of
    frames would drop *every* swipe (measured: `Swipe_Left` at 1 of 5, never published).
    A rule comes first so a matched predicate wins a tie in the vote's `max`: a
    geometric match is deterministic evidence, a probability is not.
    """
    hits = [
        GestureHit(name, vocabulary.score_for(name, config.GESTURE_RULE_SCORE))
        for name in rules
    ]
    hits.extend(
        GestureHit(
            name,
            vocabulary.score_for(name, config.GESTURE_RULE_SCORE),
            confirmed=True,
        )
        for name in motion
    )
    hits.extend(
        hits_from_gestures(
            gestures,
            min_score,
            allowed=vocabulary.by_name,
            floors={
                row.name: row.score
                for row in vocabulary.names
                if row.score is not None
            },
        )
    )
    return hits


class GestureDetector:
    def __init__(self, model_path=None, min_score=None, vocabulary=None):
        self.model_path = model_path or config.resolve_gesture_model()
        #: The **trained** classifier, or '' when there is none (the normal state).
        self.classifier_path = config.resolve_gesture_classifier()
        self.min_score = (
            config.GESTURE_MIN_SCORE if min_score is None else min_score
        )
        #: The vocabulary, read lazily: a broken table has to become a *named* reason
        #: (`unavailable_reason`), not an exception out of the feed thread.
        self._vocab = vocabulary
        #: The motion tracker (`pipeline/gesture_motion.py`), built on first use.
        self._motion = None
        self._recognizer = None
        self._timestamp_ms = 0
        self._reason = None
        self._probed = False
        #: Set when something is off but the tier still runs (e.g. a trained classifier
        #: with no `custom` row in the table) — `main.py` prints it once at startup.
        self.note = None
        #: The last raw answer (`_raw_answer`), floor included — for the trace/UI.
        self.last: dict | None = None
        #: The landmark-bearing hands of the last frame (`hands.Hand`), for the
        #: recorder (`recorder.py`) and the debug UI. Empty until the first frame.
        self.last_hands: list = []

    def _vocabulary(self):
        """The vocabulary, read once (raises `ValueError` on a broken table)."""
        if self._vocab is None:
            self._vocab = config.load_gestures()
        return self._vocab

    def unavailable_reason(self):
        """Why gestures cannot run, or None when they can.

        Probed once and cached: this check used to run on every frame (an
        `os.path.exists` plus an import attempt), and the message it fed named
        neither the cause nor the path that was searched.
        """
        if not self._probed:
            self._probed = True
            self._reason = self._probe()
        return self._reason

    def _probe(self):
        import os

        if not self.model_path or not os.path.exists(self.model_path):
            return f'model missing at {self.model_path or "<unset>"}'
        try:
            self._vocabulary()
        except ValueError as e:
            # The table is the contract: a name it does not declare is dropped, so a
            # broken table would silently publish nothing. One named line instead.
            return f'gesture vocabulary invalid ({e})'
        try:
            import mediapipe  # noqa: F401
        except Exception as e:
            # A missing shared library (libportaudio, libEGL), not just a missing
            # wheel — the error text is the only thing that says which.
            return f'mediapipe failed to import ({e})'
        try:
            # Importing the wheel is not enough: the native bindings dlopen their
            # own libraries (libEGL.so.1, libGLESv2.so.2) and parse the model when
            # the recognizer is created. Doing it here warms the recognizer up and
            # turns a library problem into one named line at startup instead of a
            # tier that fails on the first motion burst.
            self._ensure()
        except Exception as e:
            return f'mediapipe cannot start its runtime ({e})'
        return None

    def available(self) -> bool:
        return self.unavailable_reason() is None

    def _ensure(self):
        if self._recognizer is not None:
            return
        import mediapipe as mp

        vocabulary = self._vocabulary()
        options = mp.tasks.vision.GestureRecognizerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=self.model_path),
            running_mode=mp.tasks.vision.RunningMode.VIDEO,
            num_hands=config.GESTURE_NUM_HANDS,
            min_hand_detection_confidence=(
                config.GESTURE_HAND_DETECTION_CONFIDENCE
            ),
            min_hand_presence_confidence=config.GESTURE_HAND_PRESENCE_CONFIDENCE,
            min_tracking_confidence=config.GESTURE_HAND_TRACKING_CONFIDENCE,
            **self._canned_options(mp, vocabulary),
            **self._custom_options(mp, vocabulary),
        )
        self._recognizer = mp.tasks.vision.GestureRecognizer.create_from_options(
            options
        )

    def _canned_options(self, mp, vocabulary) -> dict:
        """The stock classifier, as the table's own allow list.

        `category_allowlist` is mediapipe's name for it (the C++ spelling; there is no
        `allow_list` in the Python API, and passing one is a `TypeError` when the
        recognizer is built — which is how a rename in a wheel upgrade took the whole
        tier down). An **empty** allow list means "no filter" to the converter, so a
        table that declares no `model` row sends no option at all rather than quietly
        re-opening the canned seven: `hits_from_gestures(..., allowed=…)` closes the set
        either way, this is only where the recognizer stops doing the work.
        """
        names = vocabulary.model_allow_list()
        if not names:
            return {}
        return {
            # The 1.2.x field name (`canned_gesture_classifier_options`, without the
            # "s", is a deprecated alias of it; passing both raises `ValueError`).
            'canned_gestures_classifier_options': (
                mp.tasks.components.processors.ClassifierOptions(
                    category_allowlist=names
                )
            ),
        }

    def _custom_options(self, mp, vocabulary) -> dict:
        """The trained classifier's options, or `{}` when there is no usable artifact.

        `custom_gestures_classifier_options` would **merge** a second category set with
        the canned one (MediaPipe prefers the custom label when both recognize the same
        gesture), which is what makes a trained label purely additive and revertible.
        That needs the task API to carry a *model path* for the second classifier, and
        the mediapipe we ship (1.2.3) has no such field on `ClassifierOptions` — its
        `__dataclass_fields__` holds the allow list and the floors and nothing else, so
        the artifact could never reach the graph. Rather than let the `TypeError` take
        the tier down the day such a file appears, the artifact is skipped and the
        reason is recorded in `note`. On this version the supported route to trained
        labels is the **bundle** (`train_gestures.py --export-bundle` →
        `VISION_GESTURE_MODEL`), whose labels are declared as `model` rows.
        """
        if not self.classifier_path:
            return {}
        labels = vocabulary.custom_allow_list()
        if not labels:
            # An artifact nobody declared: its labels would be dropped downstream
            # (`hits_from_gestures`), so the tier would run a classifier into silence.
            # Loaded anyway? No — say so, and let the canned categories stand.
            self.note = (
                f'gesture classifier at {self.classifier_path} ignored: the table '
                'declares no "custom" row (one per label)'
            )
            return {}
        options_cls = mp.tasks.components.processors.ClassifierOptions
        if 'model_asset_path' not in getattr(options_cls, '__dataclass_fields__', {}):
            self.note = (
                f'gesture classifier at {self.classifier_path} ignored: mediapipe '
                f'{getattr(mp, "__version__", "unknown")} takes no model path for a '
                'second classifier — train with --export-bundle and point '
                'VISION_GESTURE_MODEL at the .task (declare its labels as "model" rows)'
            )
            return {}
        return {
            'custom_gestures_classifier_options': (
                mp.tasks.components.processors.ClassifierOptions(
                    model_asset_path=self.classifier_path,
                    category_allowlist=labels,
                    score_threshold=vocabulary.custom_score_threshold(
                        self.min_score
                    ),
                )
            )
        }

    def _rule_names(self, hands, vocabulary) -> list:
        """The names the geometric rules spell (`pipeline/gesture_rules.py`)."""
        if not config.GESTURE_RULES:
            return []
        return [
            name
            for name, _hand in gesture_rules.classify_all(hands)
            if vocabulary.is_enabled(name)
        ]

    def _motion_names(self, hands, vocabulary) -> list:
        """The names a trajectory spells (`pipeline/gesture_motion.py`)."""
        if not config.GESTURE_MOTION:
            return []
        if self._motion is None:
            self._motion = gesture_motion.MotionTracker()
        now = self._timestamp_ms / 1000.0
        # A hand that left the view loses its history (its swipe is over) once its
        # samples fall out of the window; a hand MediaPipe loses for a single frame
        # keeps it. Dropping the track on that first miss (what this did) shredded a
        # swipe, whose whole travel has to fit inside the window.
        self._motion.forget(hands, now)
        return [
            name
            for name in self._motion.update(hands, now)
            if vocabulary.is_enabled(name)
        ]

    def detect(self, frame_bgr) -> list:
        """What one frame's recognition yields (empty when unavailable)."""
        if not self.available():
            return []

        import cv2
        import mediapipe as mp

        self._ensure()
        # VIDEO mode wants a strictly increasing timestamp in milliseconds — the
        # real clock, so the recognizer's internal tracking sees actual time (a
        # fixed +33 ms per call would drift away from it).
        self._timestamp_ms = max(
            int(time.monotonic() * 1000), self._timestamp_ms + 1
        )
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        result = self._recognizer.recognize_for_video(image, self._timestamp_ms)
        gestures = getattr(result, 'gestures', [])
        vocabulary = self._vocabulary()
        # The landmarks ride along with the categories in the same result: the rules and
        # the motion tier are arithmetic on them, so the wider vocabulary costs no extra
        # inference — `hand_landmarks` was already being computed and thrown away.
        hands = hands_from_result(result)
        self.last_hands = hands
        rules = self._rule_names(hands, vocabulary)
        motion = self._motion_names(hands, vocabulary)
        # The raw answer is kept before the floor filters it: the trace and the debug
        # UI need to show a hand the model called `None` at 0.97, not silence — plus
        # what the geometric and motion tiers spelled on the same frame.
        self.last = _raw_answer(gestures, hands, rules, motion)
        return hits_for_frame(gestures, rules, motion, vocabulary, self.min_score)
