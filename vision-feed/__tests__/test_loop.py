"""`pipeline.loop`: the cadence rules that decide whether a track ever flaps.

`detect_due` is the detector's cadence inside a motion burst. It used to be a 2 s
cooldown (`VISION_FEED_COOLDOWN_MS`) which *also* gated the gesture tier: the
recognizer was asked 0.5 times a second, so a 1 s wave was sampled at most once.

`look_fps` is the cadence outside a burst: the watchdog rate a quiet gate is looked
at with, always, whatever the tracks say. Believing a still person present without
ever looking is what delayed every `leave` until the gate woke up on its own —
minutes later, or never.

`policy_tracks` is what the policy is told between two detections: `None` ("nobody
looked"), never `[]` ("nobody is there"). Conflating the two was the enter/leave
churn, and it made `dwell` unreachable.

`feeds_to_stop` is the poll's tri-state: an unanswered poll stops nothing.

There is **no gesture cadence here any more**, on purpose: the recognizer is asked on
every frame the loop reads (`main.py`), because MediaPipe's `VIDEO` mode tracks the
hand across calls — a sparse schedule answered a hand and no gesture *every time*,
where the loop's own rate classified the sign (see `test_gesture.py`).
"""
import pytest

import config
from pipeline import loop
from pipeline.loop import (
    detect_due,
    feeds_to_stop,
    frame_sleep,
    look_fps,
    policy_tracks,
)


def test_detection_is_due_at_the_configured_cadence():
    # 5/s: the first frame, then not before 200 ms.
    assert detect_due(now=100.0, last_detect=0.0, detect_fps=5.0) is True
    assert detect_due(now=100.1, last_detect=100.0, detect_fps=5.0) is False
    assert detect_due(now=100.2, last_detect=100.0, detect_fps=5.0) is True


def test_a_zero_rate_disables_detection():
    assert detect_due(now=10.0, last_detect=0.0, detect_fps=0) is False


def test_a_frame_the_detector_did_not_look_at_carries_no_information():
    """`None`, never `[]` — the detector *looked and saw nobody*, or it did not look?

    The old rule reused the previous tracks (sticky), which fixed the empty-frame
    half of the churn but told the policy nothing about whether anyone had been
    seen. `None` is the honest answer: the tracker carries its unmatched tracks
    itself and marks them (`track.py`), and the policy treats `None` as "no
    information" — no `leave`, and the dwell clock keeps running.
    """
    live = ['person#1']
    assert policy_tracks(False, live) is None
    assert policy_tracks(True, live) == ['person#1']
    # A detection frame that found nobody is authoritative — and empty.
    assert policy_tracks(True, []) == []


def test_the_reported_tracks_are_a_copy_not_the_same_list():
    """The caller carries its live set across frames: no shared mutation."""
    live = ['person#1']
    out = policy_tracks(True, live)
    out.append('x')
    assert live == ['person#1']


def test_frame_sleep_pads_a_fast_iteration_and_never_goes_negative():
    assert frame_sleep(0.0, 5.0) == pytest.approx(0.2)
    assert frame_sleep(0.05, 5.0) == pytest.approx(0.15)
    assert frame_sleep(1.0, 5.0) == 0.0  # slower than the target: no wait
    assert frame_sleep(0.0, 0) == 0.0  # fps <= 0 must not sleep forever


def test_the_detector_keeps_looking_in_a_silent_room():
    """The live regression: `fps=0.0 look=0` for 20 s of a person sitting still.

    Gating the quiet rate on "a track is already alive" left the camera blind exactly
    when it mattered — the track expires after the TTL, the detector stops looking
    altogether, and the person is re-detected as a *new* id as soon as they move
    again (the old `leave` and the new `enter` in the same frame, which is the churn
    the event log showed).
    """
    assert look_fps(motion=True) == config.DETECT_FPS
    assert look_fps(motion=False) == config.QUIET_DETECT_FPS
    # Never 0: an empty room is looked at too, just slowly — that is what makes
    # `presence` mean anything for someone who never trips the gate at all.
    assert config.QUIET_DETECT_FPS > 0


def test_the_watchdog_interval_is_shorter_than_the_miss_ttl():
    """Otherwise a person standing still would age out *between two looks*."""
    assert 1.0 / config.QUIET_DETECT_FPS < config.MISS_TTL_S


def test_the_watchdog_is_a_slow_tick_not_a_burst():
    """A silent room costs a fraction of a burst: ~1 detection/s, ~5% of one core."""
    assert config.QUIET_DETECT_FPS < config.DETECT_FPS


def test_an_unanswered_poll_stops_nothing():
    """A brain restart is not a request to stop every camera."""
    assert feeds_to_stop(['c1', 'c2'], [], False) == set()
    assert feeds_to_stop(['c1'], ['c1'], False) == set()


def test_an_answered_poll_stops_only_the_cameras_that_disappeared():
    assert feeds_to_stop(['c1', 'c2'], ['c1'], True) == {'c2'}
    assert feeds_to_stop(['c1'], ['c1', 'c2'], True) == set()  # a new one starts
    assert feeds_to_stop([], ['c1'], True) == set()
    assert feeds_to_stop(['c1'], [], True) == {'c1'}  # modes cleared: stop it
