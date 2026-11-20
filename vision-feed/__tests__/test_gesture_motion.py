"""The motion tier — pure trajectories, synthetic hands, no model.

What can go wrong silently here: a swipe that never fires (the window is too short, the
travel threshold too high), a swipe that fires on a *still* hand or on a slow drift (the
sign then repeats forever), and a wave reported as a swipe (the two are the same pixels
and different instructions). Each of those is one test below, on a trajectory built by
hand — the thresholds themselves are validated against recorded clips by
`probe_gestures.py`.
"""
from dataclasses import replace

from helpers import make_hand
from pipeline.gesture_motion import MotionTracker


def track(positions, scale=1.0, step=0.1):
    """Feed one hand per position; return the names the tracker spelled.

    `scale` may be one number or one per frame — the palm's apparent size is the depth
    cue, so a push is a *changing* scale at a fixed position.
    """
    scales = (
        list(scale)
        if isinstance(scale, (list, tuple))
        else [scale] * len(positions)
    )
    tracker = MotionTracker(window_s=0.8, min_travel=1.5, min_samples=4)
    names = []
    for index, x in enumerate(positions):
        hand = make_hand(wrist=(x, 0.60), scale=scales[index])
        names.extend(tracker.update([hand], index * step))
    return names


def test_a_straight_fast_move_is_a_swipe():
    # 0.20 of the frame is two palm scales at this distance: a deliberate move, not a
    # wobble. The name is the picture's direction ("swipe left" is left on the screen).
    assert track([0.30, 0.35, 0.40, 0.45, 0.50]) == ['Swipe_Right']
    assert track([0.50, 0.45, 0.40, 0.35, 0.30]) == ['Swipe_Left']
    assert track([0.30, 0.30, 0.30, 0.30, 0.30]) == []
    assert track([0.50, 0.50, 0.50, 0.50, 0.50], step=0.1) == []


def test_a_vertical_move_is_a_vertical_swipe():
    tracker = MotionTracker(window_s=0.8, min_travel=1.5, min_samples=4)
    names = []
    for index, y in enumerate((0.40, 0.45, 0.50, 0.55, 0.60)):
        names.extend(tracker.update([make_hand(wrist=(0.50, y))], index * 0.1))
    assert names == ['Swipe_Down']


def test_a_swipe_is_consumed_not_repeated_every_frame():
    """One swipe is one event: the window restarts on the frame that fired.

    Otherwise a hand that stops after a swipe keeps reporting it (the travel stays in the
    window) — and `GestureGate` would only hide it until the cooldown elapsed.
    """
    tracker = MotionTracker(window_s=0.8, min_travel=1.5, min_samples=4)
    names = []
    for index, x in enumerate([0.30, 0.35, 0.40, 0.45, 0.50, 0.50, 0.50, 0.50, 0.50]):
        names.extend(tracker.update([make_hand(wrist=(x, 0.60))], index * 0.1))
    assert names == ['Swipe_Right']


def test_a_slow_drift_is_not_a_gesture():
    # 0.01 per frame is a hand that is simply moving; inside the window that is 0.08,
    # below the two palm scales a swipe needs.
    assert track([0.30 + 0.01 * i for i in range(10)]) == []


def test_a_two_frame_blip_is_not_a_swipe():
    assert track([0.30, 0.50, 0.50], step=0.1) == []


def test_a_window_the_trajectory_does_not_fit_in_is_not_a_swipe():
    # Half a second per step: the window only ever holds two samples, so no trajectory
    # exists to read — this is the knob that stops a slow move from being a swipe.
    assert track([0.30, 0.35, 0.40, 0.45, 0.50], step=0.5) == []


def test_a_back_and_forth_is_a_wave_not_a_swipe():
    assert track([0.30, 0.42, 0.30, 0.42, 0.30]) == ['Wave']


def test_a_hand_held_still_is_never_a_wave():
    # The reversal counter ignores steps below the jitter floor, so a still hand (whose
    # landmarks wobble) cannot look like a hand changing its mind.
    assert track([0.30, 0.3005, 0.30, 0.3005, 0.30, 0.3005]) == []


def test_the_apparent_size_is_the_depth_cue():
    # Not a landmark's z: MediaPipe's image z is wrist-relative and its world landmarks
    # are hand-centric, so "the hand got bigger" is the only honest monocular cue.
    assert track([0.40] * 5, scale=[1.0, 1.1, 1.2, 1.3, 1.4]) == ['Push']
    assert track([0.40] * 5, scale=[1.4, 1.2, 1.0, 0.9, 0.7]) == ['Pull']
    assert track([0.40] * 5, scale=[1.0, 1.02, 1.04, 1.05, 1.05]) == []


def test_two_hands_are_tracked_separately():
    tracker = MotionTracker(window_s=0.8, min_travel=1.5, min_samples=4)
    names = []
    for index, x in enumerate((0.30, 0.35, 0.40, 0.45, 0.50)):
        moving = make_hand(wrist=(x, 0.60))
        still = replace(make_hand(wrist=(0.70, 0.60)), handedness='Left')
        names.extend(tracker.update([moving, still], index * 0.1))
    assert names == ['Swipe_Right']


def test_a_single_frame_blink_keeps_the_trajectory():
    """A hand MediaPipe loses for one frame is the same hand.

    Dropping the track on that first miss shredded a swipe, whose whole travel has
    to fit inside the window — the tier was then silent on every stream that
    dropped a frame, i.e. on every real stream.
    """
    tracker = MotionTracker(window_s=0.8, min_travel=1.5, min_samples=4)
    names = []
    # Five x values for four samples: the blink frame is not one of them.
    for index, x in enumerate((0.30, 0.40, 0.50, 0.60, 0.70)):
        hands = [] if index == 2 else [make_hand(wrist=(x, 0.60))]
        names.extend(tracker.update(hands, index * 0.1))
        tracker.forget(hands, index * 0.1)
    assert names == ['Swipe_Right']


def test_a_hand_gone_for_longer_than_the_window_loses_its_trajectory():
    tracker = MotionTracker(window_s=0.8, min_travel=1.5, min_samples=4)
    tracker.update([make_hand(wrist=(0.30, 0.60))], 0.0)
    tracker.update([make_hand(wrist=(0.40, 0.60))], 0.1)
    tracker.forget([], 0.2)  # a miss...
    tracker.forget([], 1.2)  # ...that outlasted the window
    # ...so the next hand starts a new trajectory instead of finishing the old one.
    names = []
    names.extend(tracker.update([make_hand(wrist=(0.50, 0.60))], 1.3))
    names.extend(tracker.update([make_hand(wrist=(0.60, 0.60))], 1.4))
    assert names == []
