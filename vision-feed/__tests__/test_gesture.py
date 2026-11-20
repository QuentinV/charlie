"""Tier 3 gesture tests — pure stdlib, no mediapipe and no model.

The score threshold, the "no gesture" label, the per-gesture cooldown and the **vote**
are the four decisions that can go wrong silently (a gesture that never fires, a `None`
gesture that fires, one that floods the bus, or a sign held right in front of the camera
that is dropped half the time), so they are tested on the recognizer's *result shape*
directly. The availability probe is tested too: it is what turns "gestures requested"
into an actionable message instead of a silent no-op.
"""
import sys
import types

import pytest

import config

from helpers import make_hand
from pipeline import gesture_vocab
from pipeline.gesture import (
    GestureDetector,
    GestureGate,
    GestureHit,
    GestureVote,
    hits_from_gestures,
)

LONG = ('index', 'middle', 'ring', 'pinky')


class Category:
    """Stand-in for mediapipe's `Category` (name + score)."""

    def __init__(self, name, score):
        self.category_name = name
        self.score = score


def test_only_hits_above_the_threshold():
    gestures = [[Category('Thumb_Up', 0.9)], [Category('Open_Palm', 0.2)]]
    assert [h.name for h in hits_from_gestures(gestures, 0.5)] == ['Thumb_Up']


def test_only_the_best_category_of_a_hand_is_read():
    # MediaPipe returns one hand's categories best-first: the runner-up is not a
    # second gesture.
    gestures = [[Category('Victory', 0.8), Category('Pointing_Up', 0.6)]]
    hits = hits_from_gestures(gestures, 0.5)
    assert len(hits) == 1
    assert hits[0].name == 'Victory'
    assert hits[0].score == 0.8


def test_empty_and_nameless_results_are_ignored():
    assert hits_from_gestures([], 0.5) == []
    assert hits_from_gestures(None, 0.5) == []
    assert hits_from_gestures([[]], 0.5) == []
    assert hits_from_gestures([[Category('', 0.9)]], 0.5) == []
    assert hits_from_gestures([[Category(None, 0.9)]], 0.5) == []


def test_the_no_gesture_category_is_dropped():
    """MediaPipe's "no gesture" label is a real category, and it scores high.

    It is the first entry of the shipped model's label map (ahead of
    `Closed_Fist`), so a relaxed or open hand reports `None` with a good score —
    without this filter, `gesture None` events are published.
    """
    assert hits_from_gestures([[Category('None', 0.97)]], 0.5) == []
    assert hits_from_gestures([[Category('none', 0.97)]], 0.5) == []
    # ...and it does not hide a real gesture on the same frame.
    both = [[Category('None', 0.9)], [Category('Victory', 0.8)]]
    assert [h.name for h in hits_from_gestures(both, 0.5)] == ['Victory']


def test_a_held_sign_publishes_once_not_once_per_frame():
    """The throttle is the cooldown, never the sampling rate.

    The recognizer is asked on every frame the loop reads, so a sign held for a
    second at 5/s is *seen* five times — and still has to reach the bus once. This is
    what makes "ask every frame" safe: asking has no side effect, publishing does.
    """
    gate = GestureGate(cooldown_s=3.0)
    hit = GestureHit('Victory', 0.8)
    accepted = [gate.accept(hit, t) for t in (0.0, 0.2, 0.4, 0.6, 0.8)]

    assert accepted == [True, False, False, False, False]


def test_gate_publishes_once_per_cooldown():
    gate = GestureGate(cooldown_s=3.0)
    hit = GestureHit('Thumb_Up', 0.9)
    assert gate.accept(hit, 100.0) is True
    assert gate.accept(hit, 101.0) is False  # inside the cooldown
    assert gate.accept(hit, 103.0) is True  # cooldown elapsed


def test_gate_keeps_names_independent():
    gate = GestureGate(cooldown_s=3.0)
    assert gate.accept(GestureHit('Thumb_Up', 0.9), 100.0) is True
    assert gate.accept(GestureHit('Closed_Fist', 0.9), 100.5) is True


def test_the_vote_needs_a_majority_of_the_window():
    """One frame is not a gesture: a hand passing through the frame must not publish.

    The floor (`GESTURE_MIN_SCORE`) has to be low enough to see a *held* sign (the model
    measured 0.50-0.71 on one), and a floor that low lets a single ambiguous frame
    through. The majority is what separates "held" from "passed by".
    """
    vote = GestureVote(window=5, need=3)
    hit = [GestureHit('Victory', 0.4)]

    assert vote.observe(hit) == []  # 1/5
    assert vote.observe([]) == []  # the hand left: the window still has 1
    assert vote.observe(hit) == []
    assert vote.observe(hit) == [hit[0]]  # 3 of the last 5: a sign, held


def test_the_vote_fires_once_per_run_of_frames():
    """A sign held for a second must not publish once per frame.

    The cooldown gate would de-duplicate it, but the event would still be submitted —
    and escalated — for nothing.
    """
    vote = GestureVote(window=5, need=3)
    hit = [GestureHit('Thumb_Up', 0.8)]
    fired = [vote.observe(hit) for _ in range(6)]

    assert [bool(f) for f in fired] == [False, False, True, False, False, False]


def test_the_vote_forgets_a_name_that_left_the_window():
    """Three looks spread over more than the window are not a majority."""
    vote = GestureVote(window=3, need=3)
    hit = [GestureHit('Closed_Fist', 0.5)]
    assert vote.observe(hit) == []
    assert vote.observe([]) == []
    assert vote.observe([]) == []
    assert vote.observe(hit) == []  # only one of the last three again
    assert vote.observe(hit) == []
    assert vote.observe(hit) == [hit[0]]  # ...now three consecutive ones


def test_the_vote_reads_the_best_hit_of_a_frame():
    """Two hands, two signs: a frame votes once, with its strongest answer."""
    vote = GestureVote(window=1, need=1)
    both = [GestureHit('Open_Palm', 0.4), GestureHit('Victory', 0.9)]

    assert [h.name for h in vote.observe(both)] == ['Victory']
    assert vote.history == ['Victory']


def test_a_confirmed_hit_is_published_without_a_vote():
    """A trajectory cannot be voted on: it fires once and is consumed.

    The vote waits for `need` of the last `window` frames to agree — the right
    question for a per-frame probability, the wrong one for a window summary. A swipe
    is one frame long by construction (nothing repeats it), so a majority never
    formed and *every* motion gesture was dropped: measured live, `Swipe_Left`
    scored 1 of 5 and was never published.
    """
    vote = GestureVote(window=5, need=3)
    motion = [GestureHit('Swipe_Left', 0.9, confirmed=True)]

    assert vote.observe(motion) == motion
    # ...and it does not enter the window: the next frame votes on its own answer.
    assert vote.history == ['']
    assert vote.observe([GestureHit('Victory', 0.5)]) == []


def test_a_trajectory_rides_along_with_a_voted_name():
    """Both kinds in one frame: the trajectory goes out, the sign keeps voting."""
    vote = GestureVote(window=5, need=1)
    both = [
        GestureHit('Swipe_Right', 0.9, confirmed=True),
        GestureHit('Victory', 0.5),
    ]
    assert [h.name for h in vote.observe(both)] == ['Swipe_Right', 'Victory']


def test_the_vote_can_be_disabled():
    """`window=1, need=1` is the old behaviour (the floor alone decides)."""
    vote = GestureVote(window=1, need=1)
    hit = [GestureHit('Victory', 0.4)]
    assert vote.observe(hit) == hit


def test_a_need_bigger_than_the_window_is_clamped():
    """`need=5, window=3` would never be satisfied: a gesture tier that silently dies."""
    vote = GestureVote(window=3, need=5)
    assert vote.need == 3
    hit = [GestureHit('Victory', 0.9)]
    assert vote.observe(hit) == []
    assert vote.observe(hit) == []
    assert vote.observe(hit) == hit


def test_the_raw_answer_keeps_what_the_floor_rejects():
    """The trace needs `None` at 0.97, not silence.

    `hits_from_gestures` deliberately hides what it rejects; "the model saw a hand and
    called it `None`" is exactly what a person debugging a sign has to see.
    """
    from pipeline.gesture import _raw_answer

    gestures = [[Category('None', 0.97)], [Category('Victory', 0.51)]]
    assert hits_from_gestures(gestures, 0.35) == [GestureHit('Victory', 0.51)]
    assert _raw_answer(gestures) == {'hands': 2, 'top': 'None', 'score': 0.97}
    assert _raw_answer([]) == {'hands': 0, 'top': '', 'score': 0.0}
    assert _raw_answer(None) == {'hands': 0, 'top': '', 'score': 0.0}


def test_the_detector_is_unavailable_without_a_model():
    detector = GestureDetector(model_path='no-such-model.task')
    assert detector.available() is False
    # detect() short-circuits before importing cv2/mediapipe, and says so with an
    # empty answer (not a crash, and not a gesture it never looked for).
    assert detector.detect(None) == []


def test_the_reason_names_the_path_it_looked_for():
    # The old message said "mediapipe/model missing" and neither *which* of the
    # two nor where it looked — the two things the fix needs.
    detector = GestureDetector(model_path='no-such-model.task')
    assert detector.unavailable_reason() == 'model missing at no-such-model.task'


def test_no_reason_when_the_model_and_mediapipe_are_there(monkeypatch, tmp_path):
    model = tmp_path / 'gesture_recognizer.task'
    model.write_bytes(b'x')
    # A stub module: `import mediapipe` inside the probe resolves to it.
    monkeypatch.setitem(sys.modules, 'mediapipe', types.ModuleType('mediapipe'))

    detector = GestureDetector(model_path=str(model))
    # The probe goes on to create the recognizer; stubbed (no mediapipe here).
    monkeypatch.setattr(detector, '_ensure', lambda: None)

    assert detector.unavailable_reason() is None
    assert detector.available() is True


def test_a_runtime_that_cannot_start_is_named(monkeypatch, tmp_path):
    # The wheel imports fine even when its native bindings cannot dlopen
    # libEGL/libGLESv2 — which is exactly what a slim image hits.
    model = tmp_path / 'gesture_recognizer.task'
    model.write_bytes(b'x')
    monkeypatch.setitem(sys.modules, 'mediapipe', types.ModuleType('mediapipe'))

    detector = GestureDetector(model_path=str(model))

    def boom():
        raise OSError('libEGL.so.1: cannot open shared object file')

    monkeypatch.setattr(detector, '_ensure', boom)

    assert detector.available() is False
    assert detector.unavailable_reason() == (
        'mediapipe cannot start its runtime '
        '(libEGL.so.1: cannot open shared object file)'
    )


def test_the_reason_is_probed_once(monkeypatch):
    # It used to run `os.path.exists` + an import attempt on every frame.
    detector = GestureDetector(model_path='no-such-model.task')
    calls = []

    def fake_probe():
        calls.append(1)
        return 'stubbed'

    monkeypatch.setattr(detector, '_probe', fake_probe)
    assert detector.available() is False
    assert detector.available() is False
    assert len(calls) == 1


# --- The vocabulary the hits are filtered by ---------------------------------


def test_a_name_the_table_does_not_declare_is_dropped():
    """The vocabulary is **closed**: a label a future bundle adds cannot reach the bus.

    The table is also what the recognizer's `allow_list` is built from, so this is the
    second line of defence — a name nobody declared has no row to be enabled by.
    """
    gestures = [[Category('SomeFutureLabel', 0.99)], [Category('Victory', 0.8)]]
    hits = hits_from_gestures(gestures, 0.35, allowed={'Victory'})
    assert [h.name for h in hits] == ['Victory']


def test_a_per_name_floor_overrides_the_global_one():
    # A trained label usually needs a stricter floor than a canned category, and the
    # table carries it per row so the global floor stays where a canned label wants it.
    gestures = [[Category('Pinch', 0.5)]]
    assert hits_from_gestures(gestures, 0.35) == [GestureHit('Pinch', 0.5)]
    assert hits_from_gestures(gestures, 0.35, floors={'Pinch': 0.6}) == []


def test_the_geometric_rules_are_filtered_by_the_table():
    detector = GestureDetector(model_path='x.task')
    vocabulary = gesture_vocab.DEFAULT_VOCABULARY
    hand = make_hand(extended=LONG, thumb='up', spread=True)

    assert detector._rule_names([hand], vocabulary) == ['Stop']

    disabled = gesture_vocab.parse_vocabulary(
        {'names': [{'name': 'Stop', 'source': 'rules', 'enabled': False}]}
    )
    assert detector._rule_names([hand], disabled) == []


def test_a_frame_puts_the_rules_first_and_the_trajectories_confirmed():
    """The flag is the fix; the order is the tie-break.

    One frame, three sources: a geometric rule (deterministic, voted on), a
    trajectory (a window summary, published as it fires) and the model's own
    category (a probability, voted on).
    """
    from pipeline.gesture import hits_for_frame

    hits = hits_for_frame(
        [[Category('Open_Palm', 0.7)]],
        ['Stop'],
        ['Swipe_Left'],
        gesture_vocab.DEFAULT_VOCABULARY,
        0.35,
    )
    assert [h.name for h in hits] == ['Stop', 'Swipe_Left', 'Open_Palm']
    assert [h.confirmed for h in hits] == [False, True, False]


def test_the_new_tiers_have_switches(monkeypatch):
    detector = GestureDetector(model_path='x.task')
    vocabulary = gesture_vocab.DEFAULT_VOCABULARY
    monkeypatch.setattr(config, 'GESTURE_RULES', 0)
    monkeypatch.setattr(config, 'GESTURE_MOTION', 0)
    assert detector._rule_names([make_hand()], vocabulary) == []
    assert detector._motion_names([make_hand()], vocabulary) == []


def test_the_motion_tier_reports_its_trajectory_as_a_hit():
    detector = GestureDetector(model_path='x.task')
    vocabulary = gesture_vocab.DEFAULT_VOCABULARY
    names = []
    for index, x in enumerate((0.30, 0.35, 0.40, 0.45, 0.50)):
        detector._timestamp_ms = int(index * 100)
        names.extend(
            detector._motion_names([make_hand(wrist=(x, 0.60))], vocabulary)
        )
    assert names == ['Swipe_Right']


# --- The mediapipe API surface (the drift that took the tier down) -------------
#
# `allow_list` was never a mediapipe keyword and `canned_gesture_classifier_options` had
# stopped being the field name — the feed crashed in the container while this suite stayed
# green, because the stub accepted **any** keyword. mediapipe's options are dataclasses, so
# these stubs carry `__dataclass_fields__` and refuse what mediapipe refuses.


def _options_stub(fields):
    """A `ClassifierOptions` stand-in that knows its own field set."""

    class Options:
        __dataclass_fields__ = {name: None for name in fields}

        def __init__(self, **kwargs):
            unknown = sorted(set(kwargs) - set(fields))
            if unknown:
                raise TypeError(
                    'ClassifierOptions() got an unexpected keyword argument '
                    f'{unknown[0]!r}'
                )
            self.kwargs = kwargs

    return Options


#: mediapipe 1.2.x — the one in the image: no model path for a second classifier.
_MP_FIELDS = (
    'category_allowlist',
    'category_denylist',
    'score_threshold',
    'display_names_locale',
    'max_results',
)
_MP_12 = _options_stub(_MP_FIELDS)
#: The API the trained-classifier path was written against (a model path per classifier).
_MP_LEGACY = _options_stub(_MP_FIELDS + ('model_asset_path',))


def _mp_stub(options_cls=None):
    return types.SimpleNamespace(
        __version__='stub',
        tasks=types.SimpleNamespace(
            components=types.SimpleNamespace(
                processors=types.SimpleNamespace(
                    ClassifierOptions=options_cls or _MP_LEGACY
                )
            )
        ),
    )


def _mp_module(options_cls):
    """Enough mediapipe to build the whole option bag (`_ensure`), field-checked.

    `GestureRecognizerOptions` here rejects an unknown keyword exactly as mediapipe's
    dataclass does, which is the failure this stub exists to reproduce: the tier died on a
    keyword mediapipe has never had, and nothing in the suite noticed.
    """

    class Options:
        __dataclass_fields__ = {
            name: None
            for name in (
                'base_options',
                'running_mode',
                'num_hands',
                'min_hand_detection_confidence',
                'min_hand_presence_confidence',
                'min_tracking_confidence',
                'canned_gestures_classifier_options',
                'custom_gestures_classifier_options',
                'result_callback',
            )
        }

        def __init__(self, **kwargs):
            unknown = sorted(set(kwargs) - set(self.__dataclass_fields__))
            if unknown:
                raise TypeError(
                    'GestureRecognizerOptions() got an unexpected keyword argument '
                    f'{unknown[0]!r}'
                )
            self.kwargs = kwargs

    class BaseOptions:
        def __init__(self, model_asset_path=None):
            self.model_asset_path = model_asset_path

    class Recognizer:
        def __init__(self, options):
            self.options = options

        @staticmethod
        def create_from_options(options):
            return Recognizer(options)

    return types.SimpleNamespace(
        __version__='stub',
        tasks=types.SimpleNamespace(
            BaseOptions=BaseOptions,
            components=types.SimpleNamespace(
                processors=types.SimpleNamespace(ClassifierOptions=options_cls)
            ),
            vision=types.SimpleNamespace(
                RunningMode=types.SimpleNamespace(VIDEO='VIDEO'),
                GestureRecognizerOptions=Options,
                GestureRecognizer=Recognizer,
            ),
        ),
    )


def test_the_option_bag_matches_the_mediapipe_api(monkeypatch, tmp_path):
    """The whole recognizer is assembled against mediapipe's own field names.

    This is the regression the container hit: the canned option was named
    `canned_gesture_classifier_options` and its allow list `allow_list`, so `_ensure`
    raised and the tier reported "mediapipe cannot start its runtime" — names this stub,
    like mediapipe, refuses.
    """
    model = tmp_path / 'gesture_recognizer.task'
    model.write_bytes(b'x')
    monkeypatch.setitem(sys.modules, 'mediapipe', _mp_module(_MP_12))

    detector = GestureDetector(model_path=str(model))

    assert detector.available() is True
    assert detector.unavailable_reason() is None
    passed = detector._recognizer.options.kwargs
    assert passed['canned_gestures_classifier_options'].kwargs == {
        'category_allowlist': gesture_vocab.DEFAULT_VOCABULARY.model_allow_list()
    }


def test_the_canned_options_carry_the_tables_allow_list():
    detector = GestureDetector(model_path='x.task')
    options = detector._canned_options(_mp_stub(), gesture_vocab.DEFAULT_VOCABULARY)

    assert list(options) == ['canned_gestures_classifier_options']
    assert options['canned_gestures_classifier_options'].kwargs == {
        'category_allowlist': gesture_vocab.DEFAULT_VOCABULARY.model_allow_list()
    }
    # `ILoveYou` ships disabled, so it is not on the list the recognizer is handed (on
    # 1.2.x an *empty* list would mean "no filter" — the next test).
    assert (
        'ILoveYou'
        not in options['canned_gestures_classifier_options'].kwargs[
            'category_allowlist'
        ]
    )


def test_an_empty_model_allow_list_sends_no_option():
    """An empty `category_allowlist` means *no filter* to mediapipe, not *nothing*.

    A table declaring no `model` row would silently re-open the whole canned set, so the
    option is not sent at all: `hits_from_gestures(..., allowed=…)` is what closes the
    set, and a disabled row is dropped there anyway.
    """
    detector = GestureDetector(model_path='x.task')
    vocabulary = gesture_vocab.parse_vocabulary(
        {'names': [{'name': 'Pinch', 'source': 'custom'}]}
    )

    assert detector._canned_options(_mp_stub(), vocabulary) == {}


def test_the_options_are_accepted_by_the_installed_mediapipe():
    """The one test that asks the **real** wheel (skipped outside the container).

    A stub can only reproduce the field set someone wrote down; this asks mediapipe
    itself, which is what the container's crash was about. It needs the baked model, so it
    runs where that debugging does:
    `docker compose exec vision-feed python -m pytest`.
    """
    mp = pytest.importorskip('mediapipe')
    model = config.resolve_gesture_model()
    if not model:
        pytest.skip('no gesture model baked in this environment')

    detector = GestureDetector(model_path=model)
    vocabulary = gesture_vocab.DEFAULT_VOCABULARY
    options = mp.tasks.vision.GestureRecognizerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=model),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_hands=config.GESTURE_NUM_HANDS,
        min_hand_detection_confidence=config.GESTURE_HAND_DETECTION_CONFIDENCE,
        min_hand_presence_confidence=config.GESTURE_HAND_PRESENCE_CONFIDENCE,
        min_tracking_confidence=config.GESTURE_HAND_TRACKING_CONFIDENCE,
        **detector._canned_options(mp, vocabulary),
        **detector._custom_options(mp, vocabulary),
    )
    recognizer = mp.tasks.vision.GestureRecognizer.create_from_options(options)
    try:
        assert recognizer is not None
    finally:
        recognizer.close()


def test_the_trained_classifier_is_only_passed_when_the_table_declares_it(tmp_path):
    """The plumbing around the blob is testable even though the blob is not.

    An artifact with no `custom` row would run a classifier whose labels are dropped
    downstream — a classifier into silence — so the option is skipped and the reason is
    recorded for `main.py` to print.
    """
    artifact = tmp_path / 'gesture_classifier.tflite'
    artifact.write_bytes(b'x')
    detector = GestureDetector(model_path='x.task')
    detector.classifier_path = str(artifact)

    assert detector._custom_options(_mp_stub(), gesture_vocab.DEFAULT_VOCABULARY) == {}
    assert 'declares no "custom" row' in detector.note

    trained = gesture_vocab.parse_vocabulary(
        {
            'names': [
                {'name': 'Pinch', 'source': 'custom', 'score': 0.6},
                {'name': 'Point_Left', 'source': 'custom'},
            ]
        }
    )
    passed = detector._custom_options(_mp_stub(), trained)[
        'custom_gestures_classifier_options'
    ].kwargs
    assert passed['model_asset_path'] == str(artifact)
    assert passed['category_allowlist'] == ['Pinch', 'Point_Left']
    # One threshold for the whole classifier (the option is per-classifier, not
    # per-label): the *lowest* floor among the trained rows, so no label is silently
    # unreachable. `Point_Left` declares no floor, so it falls back to the global one —
    # its own 0.6 is applied downstream, per name, in `hits_from_gestures`.
    assert passed['score_threshold'] == config.GESTURE_MIN_SCORE

    trained = gesture_vocab.parse_vocabulary(
        {
            'names': [
                {'name': 'Pinch', 'source': 'custom', 'score': 0.6},
                {'name': 'Point_Left', 'source': 'custom', 'score': 0.8},
            ]
        }
    )
    passed = detector._custom_options(_mp_stub(), trained)[
        'custom_gestures_classifier_options'
    ].kwargs
    assert passed['score_threshold'] == 0.6  # the lowest custom floor


def test_the_trained_classifier_is_skipped_where_the_api_takes_no_model_path(tmp_path):
    """1.2.x has no model path for a second classifier — say so, never crash.

    `resolve_gesture_classifier()` finds the artifact the moment it lands in `models/`, so
    a `TypeError` here would take the canned categories, the geometric rules and the motion
    tier down with it — over a file the operator had every right to drop in. The supported
    route to trained labels on this version is the bundle
    (`train_gestures.py --export-bundle` → `VISION_GESTURE_MODEL`).
    """
    artifact = tmp_path / 'gesture_classifier.tflite'
    artifact.write_bytes(b'x')
    detector = GestureDetector(model_path='x.task')
    detector.classifier_path = str(artifact)
    trained = gesture_vocab.parse_vocabulary(
        {'names': [{'name': 'Pinch', 'source': 'custom'}]}
    )

    assert detector._custom_options(_mp_stub(_MP_12), trained) == {}
    assert 'takes no model path for a second classifier' in detector.note
    assert '--export-bundle' in detector.note


def test_no_trained_artifact_means_no_custom_options():
    # The normal state: the canned categories keep working, nothing extra is loaded, and
    # there is nothing to report.
    detector = GestureDetector(model_path='x.task')
    detector.classifier_path = ''
    assert detector._custom_options(_mp_stub(), gesture_vocab.DEFAULT_VOCABULARY) == {}
    assert detector.note is None


def test_a_broken_vocabulary_is_one_named_line(monkeypatch, tmp_path):
    """A table that does not validate drops every name downstream — say so.

    The alternative (a silent fallback to *some* vocabulary) would publish a different
    name set than the operator's table declares, which is worse than no gestures.
    """
    model = tmp_path / 'gesture_recognizer.task'
    model.write_bytes(b'x')

    def boom():
        raise ValueError("row 3 ('Stop') has source 'ruels'")

    monkeypatch.setattr(config, 'load_gestures', boom)
    detector = GestureDetector(model_path=str(model))
    assert detector.available() is False
    assert detector.unavailable_reason() == (
        "gesture vocabulary invalid (row 3 ('Stop') has source 'ruels')"
    )


def test_the_raw_answer_reports_the_landmarks_and_the_rules():
    # The trace has to show *why* a sign did not fire: how many hands were tracked, what
    # the model called them, and what the geometric tier spelled.
    from pipeline.gesture import _raw_answer

    hands = [make_hand(extended=LONG, thumb='up', spread=True)]
    answer = _raw_answer([[Category('Open_Palm', 0.7)]], hands, ['Stop'])
    assert answer['hands'] == 1
    assert answer['top'] == 'Open_Palm'
    assert answer['landmarks'] == 1
    assert answer['rules'] == ['Stop']
