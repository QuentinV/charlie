"""The static rules and the hand features they read — pure, synthetic hands.

What can go wrong silently here: a rule that never fires (a sign the user holds and
nothing happens), a rule that fires on a relaxed hand (`Pinch` on a fist — a pose the
canned model names `Closed_Fist`), and two rules firing on one frame (the vote then
flickers between two names for a single sign). All three are tested against synthetic
hands with the real proportions (`helpers.make_hand`); the *thresholds* are validated
against recorded clips by `probe_gestures.py`, which is the other half of the story.
"""
from helpers import Landmark, landmarks_of, make_hand
from pipeline.gesture_rules import classify, classify_all
from pipeline.hands import hand_from_landmarks, hands_from_result

LONG = ('index', 'middle', 'ring', 'pinky')


def test_a_straight_finger_and_a_curled_one_are_far_apart():
    # The band between the two is deliberate (`EXTEND_RATIO`): a half curl is not
    # evidence for a sign, so the measure has to separate them by a wide margin.
    assert make_hand(extended=('index',)).reach('index') > 2.0
    assert make_hand().reach('index') < 1.0
    assert make_hand(extended=('index',)).extended('index') is True
    assert make_hand().extended('index') is False


def test_the_thumb_is_measured_against_the_palm_not_its_own_chain():
    assert make_hand(thumb='up').extended('thumb') is True
    assert make_hand(thumb='side').extended('thumb') is True
    assert make_hand().extended('thumb') is False  # tucked across the palm


def test_the_five_and_the_stop_are_told_apart_by_the_spread():
    # Same fingers, different hand: this is what replaces "is the palm facing the
    # camera" (which would need MediaPipe's mirrored handedness to be calibrated).
    assert make_hand(extended=LONG, thumb='up', spread=True).spread() is True
    assert make_hand(extended=LONG, thumb='up').spread() is False


def test_every_rule_fires_on_its_own_pose():
    cases = {
        'Stop': make_hand(extended=LONG, thumb='up', spread=True),
        'Five': make_hand(extended=LONG, thumb='up'),
        'Four': make_hand(extended=LONG),
        'Three': make_hand(extended=('index', 'middle', 'ring')),
        'OK': make_hand(extended=LONG, thumb='contact'),
        'Pinch': make_hand(extended=('index',), thumb='contact'),
        'Rock': make_hand(extended=('index', 'pinky')),
        'Call_Me': make_hand(extended=('pinky',), thumb='up'),
        'Thumbs_Sideways': make_hand(thumb='side'),
        'Point_Left': make_hand(extended=('index',), direction=(-1.0, 0.0)),
        'Point_Right': make_hand(extended=('index',), direction=(1.0, 0.0)),
        'Point_Down': make_hand(extended=('index',), direction=(0.0, 1.0)),
    }
    for expected, hand in cases.items():
        assert classify(hand) == expected, expected


def test_the_rules_do_not_shadow_what_the_model_already_names():
    """None means "the canned label stands" — the point of the whole design.

    A raised index is `Pointing_Up`, index+middle is `Victory`, a vertical thumb is
    `Thumb_Up`: a rule for any of them would only rename what the bundle already does
    well, and would outrank it (a matched predicate beats a probability in the vote).
    """
    assert classify(make_hand(extended=('index',))) is None
    assert classify(make_hand(extended=('index', 'middle'))) is None
    assert classify(make_hand(thumb='up')) is None


def test_a_relaxed_hand_is_never_a_gesture():
    assert classify(make_hand()) is None
    assert classify(None) is None


def test_a_fist_whose_thumb_brushes_the_index_tip_is_not_a_pinch():
    """The guard `CONTACT_REACH` exists for: the thumb tip passes near the index tip.

    Without it, a closed fist — the most common pose in front of a camera — would be
    published as `Pinch` on every frame, and the canned `Closed_Fist` would never win.
    """
    fist = make_hand(thumb='contact')  # contact geometry, curled index
    assert fist.contact() is True
    assert fist.reach('index') < 1.1
    assert classify(fist) is None


def test_one_frame_yields_at_most_one_name_per_hand():
    # The partition: two names for one hand would make `GestureVote` flicker between
    # them, which is invisible in a log and infuriating in use.
    hands = [make_hand(extended=LONG, thumb='up', spread=True), make_hand()]
    assert [name for name, _hand in classify_all(hands)] == ['Stop']
    assert classify_all([]) == []


def test_hands_are_read_from_the_same_result_the_categories_come_from():
    class Category:
        def __init__(self, name, score):
            self.category_name, self.score = name, score

    class Result:
        def __init__(self):
            self.gestures = [[Category('Victory', 0.8)]]
            self.hand_landmarks = [landmarks_of(make_hand(extended=LONG))]
            self.hand_world_landmarks = []
            self.handedness = [[Category('Right', 0.99)]]

    hands = hands_from_result(Result())
    assert len(hands) == 1
    assert hands[0].handedness == 'Right'
    assert classify(hands[0]) == 'Four'
    # A result with nothing in it is an empty list, never a crash.
    assert hands_from_result(None) == []
    assert hands_from_result(type('R', (), {})()) == []


def test_a_short_landmark_list_is_not_a_hand():
    # MediaPipe always returns 21; a truncated one would index out of range deep inside
    # a rule (a per-frame exception is a dead feed thread).
    assert hand_from_landmarks([Landmark(0.5, 0.5)] * 20) is None
    assert hand_from_landmarks([]) is None
    assert hand_from_landmarks(None) is None
    assert hand_from_landmarks(['not a landmark'] * 21) is None
