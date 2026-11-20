"""`pipeline.track`: the IoU tracker (id stability is what the policy reports).

This replaced the `supervision` ByteTrack wrapper, which had silently degraded to
exactly this matcher (`sv.ByteTrack` is gone in supervision 0.31.7, and the
`except Exception` hid it). What matters is that one person keeps **one** id: a
new id is an `enter` and a lost id is a `leave`, so id churn is what made the
event log flap (and what kept `dwell` out of reach).

`update` returns the **live set** (matched + carried-with-`matched=False`), and the
four states a track can be in are all tested here: matched by overlap, matched by
**re-association** (the box jumped, or the person came back — `_near`), carried across
a miss, and kept alive across a **stream gap** (`keep` — the source died, so nobody
could look; a quiet motion gate is no longer this case, the loop keeps looking there).
"""
from dataclasses import dataclass

from pipeline.track import IouTracker


@dataclass
class D:
    cls: str
    box: tuple
    conf: float = 0.9


BOX = (0.0, 0.0, 100.0, 100.0)
#: Overlaps `BOX` too little for the strict IoU rule (0.25) but is clearly the same
#: place — a person whose box jumped, e.g. the detector snapping to the full body.
JUMPED = (55.0, 0.0, 155.0, 100.0)


def _matched(tracks):
    """Only the tracks the detector actually confirmed on this frame."""
    return [t for t in tracks if t.matched]


def test_the_same_box_keeps_the_same_id():
    t = IouTracker()
    first = t.update([D('person', BOX)], now=0.0)
    second = t.update([D('person', (5.0, 5.0, 105.0, 105.0))], now=0.2)
    assert [x.id for x in first] == [x.id for x in second] == [1]


def test_a_distant_box_opens_a_new_track():
    t = IouTracker()
    t.update([D('person', BOX)], now=0.0)
    other = t.update([D('person', (500.0, 500.0, 600.0, 600.0))], now=0.2)
    assert [x.id for x in _matched(other)] == [2]


def test_a_class_change_does_not_inherit_the_id():
    """A `cat` in the box a `person` just left is not the same track."""
    t = IouTracker()
    t.update([D('person', BOX)], now=0.0)
    assert [x.id for x in _matched(t.update([D('cat', BOX)], now=0.2))] == [2]


def test_one_missed_detection_does_not_mint_a_new_id():
    """The flapping guard: one frame without a detection, same person.

    The live set still carries the track, marked `matched=False`: it is alive, it
    simply was not confirmed — which is what lets the policy tell a blink from a
    departure (and what "return only the matched tracks" used to hide).
    """
    t = IouTracker()
    t.update([D('person', BOX)], now=0.0)

    carried = t.update([], now=0.2)
    assert [x.id for x in carried] == [1]
    assert carried[0].matched is False
    assert _matched(carried) == []

    again = t.update([D('person', BOX)], now=0.4)
    assert [x.id for x in again] == [1]
    assert again[0].matched is True


def test_a_carried_track_keeps_the_last_box_the_detector_gave():
    """The carried box is what the next detection is matched against."""
    t = IouTracker()
    t.update([D('person', BOX, conf=0.7)], now=0.0)
    carried = t.update([], now=0.2)[0]
    assert carried.box == BOX
    assert carried.cls == 'person'
    assert carried.conf == 0.7


def test_keep_holds_a_track_alive_across_a_stream_gap():
    """A dead stream is not a departure.

    While the source is down nobody could have looked, so the loop says so (`keep`)
    once the stream is back, instead of letting wall-clock TTL forget a person who is
    standing right there — their next detection would otherwise mint a new id, i.e. an
    `enter` for someone who never left.
    """
    t = IouTracker(ttl_s=1.0)
    live = t.update([D('person', BOX)], now=0.0)
    # ...9.5 s of stream outage (no frame was read at all), then the resume.
    t.keep(live, now=9.5)

    again = t.update([D('person', BOX)], now=9.6)
    assert [x.id for x in again] == [1]


def test_without_keep_a_long_gap_forgets_them():
    """The counter-proof: silence alone is not being told they are still there.

    Beyond the re-association window there is no evidence left to match against, so a
    person detected again after it is a **new** id — which is what lets the policy
    report the `leave` and then the `enter`. (Inside the window the id is kept: see
    `test_a_person_who_left_and_came_back_inside_the_grace_keeps_their_id`.)
    """
    t = IouTracker(ttl_s=1.0, grace_s=1.0)
    t.update([D('person', BOX)], now=0.0)
    late = t.update([D('person', BOX)], now=5.0)
    assert [x.id for x in late] == [2]


def test_a_box_that_jumps_keeps_its_id():
    """The live symptom: an id per box jump, i.e. an `enter`/`leave` pair every few s.

    The strict IoU rule alone minted a new id as soon as a box moved further than it
    overlapped — someone sitting down, the detector snapping from a partial to a
    full-body box, a fast walk. Re-association (`_near`) keeps the id: same class,
    compatible size, centre inside the box.
    """
    t = IouTracker()
    first = t.update([D('person', BOX)], now=0.0)
    jumped = t.update([D('person', JUMPED)], now=0.2)

    assert [x.id for x in first] == [1]
    assert [x.id for x in jumped] == [1]
    assert jumped[0].matched is True
    assert jumped[0].box == JUMPED  # the box follows the detection, not the other way


def test_a_person_who_left_and_came_back_inside_the_grace_keeps_their_id():
    """Left the frame and back 4 s later: one visit, not two.

    The track is carried (unconfirmed) for the whole re-association window, so the
    policy never sees a departure and no second `enter` is minted.
    """
    t = IouTracker(ttl_s=2.0, grace_s=6.0)
    t.update([D('person', BOX)], now=0.0)

    # Nobody was detected for 4 s (longer than the strict TTL).
    assert t.update([], now=2.5)[0].matched is False
    back = t.update([D('person', (10.0, 0.0, 110.0, 100.0))], now=4.0)

    assert [x.id for x in back] == [1]
    assert back[0].matched is True


def test_the_grace_window_ends():
    """Beyond it the id is gone for good — the `leave` the policy reports is real."""
    t = IouTracker(ttl_s=2.0, grace_s=6.0)
    t.update([D('person', BOX)], now=0.0)
    late = t.update([D('person', (10.0, 0.0, 110.0, 100.0))], now=6.5)

    assert [x.id for x in late] == [2]
    assert 1 not in t._seen


def test_re_association_respects_the_class():
    """A `cat` in the place a `person` just left is not that person."""
    t = IouTracker()
    t.update([D('person', BOX)], now=0.0)
    assert [x.id for x in _matched(t.update([D('cat', JUMPED)], now=0.2))] == [2]


def test_re_association_respects_the_size():
    """A box three times the size is a different thing, however close its centre is.

    Without the scale test, a `person` box could absorb a car passing in front of it.
    """
    t = IouTracker()
    t.update([D('person', BOX)], now=0.0)
    huge = t.update([D('person', (0.0, 0.0, 400.0, 100.0))], now=0.2)
    assert [x.id for x in _matched(huge)] == [2]


def test_re_association_compares_the_scale_not_each_side():
    """A person's box narrows with distance: the width alone must not decide.

    Measured live on 1080p: the same person's box went 1341x809 px → 780x860 px as they
    walked away — the width collapsed, the height stood still. A per-dimension size test
    (each side within 35%) rejected that match and minted a new id; the scale (the larger
    dimension) keeps it.
    """
    t = IouTracker(ttl_s=2.0, grace_s=6.0)
    t.update([D('person', (284.0, 258.0, 1625.0, 1067.0))], now=0.0)

    # Further off and shifted: the strict IoU pass fails (0.22), the scale holds (0.45).
    back = t.update([D('person', (800.0, 300.0, 1200.0, 900.0))], now=0.2)

    assert [x.id for x in back] == [1]
    assert back[0].matched is True


def test_re_association_respects_the_distance():
    """The person across the room is a different track, not a jumped box."""
    t = IouTracker()
    t.update([D('person', BOX)], now=0.0)
    assert [x.id for x in _matched(t.update([D('person', (300.0, 0.0, 400.0, 100.0))], now=0.2))] == [2]


def test_grace_cannot_be_shorter_than_the_ttl():
    """A shorter grace would retire an id the policy still believes in.

    The revival would then come back as a *new* visit carrying the *same* id — an
    `enter` for someone who never left, which is the bug this window exists to fix.
    """
    assert IouTracker(ttl_s=5.0, grace_s=1.0).grace_s == 5.0


#: A person's box at 1080p, walking away from the camera: the **width** collapses (the
#: height much less), which is what a strict size test rejects. Captured live
#: (`person` 1341x809 px in front of the camera, then the same person further off).
WALKING_AWAY = (
    (284.0, 258.0, 1625.0, 1067.0),
    (300.0, 260.0, 1500.0, 1040.0),
    (340.0, 270.0, 1300.0, 1000.0),
    (420.0, 300.0, 1100.0, 950.0),
    (520.0, 340.0, 900.0, 900.0),
    (640.0, 380.0, 780.0, 860.0),
)


def test_a_person_walking_away_keeps_their_id():
    """The live sequence: the box shrinks by 3x over 3 s, and it is still one person.

    At the loop's 5/s (0.2 s steps here) the strict IoU rule carries every step on its
    own, which is why the re-association window exists for the *gaps* (a missed
    detection, a jump), not for a smooth walk.
    """
    t = IouTracker(ttl_s=2.0, grace_s=6.0)
    ids = [
        t.update([D('person', box)], now=i * 0.2)[0].id
        for i, box in enumerate(WALKING_AWAY)
    ]
    assert ids == [1] * len(WALKING_AWAY)


def test_a_person_walking_away_at_two_fps_keeps_their_id():
    """The same walk on a 2/s loop (the host default): the steps are twice as big."""
    t = IouTracker(ttl_s=2.0, grace_s=6.0)
    ids = [
        t.update([D('person', box)], now=i * 0.5)[0].id
        for i, box in enumerate(WALKING_AWAY)
    ]
    assert ids == [1] * len(WALKING_AWAY)


def test_a_person_who_vanishes_for_a_step_and_comes_back_further_off_keeps_their_id():
    """One missed detection plus a 3x-smaller box: re-association, not a new visit.

    This is the case the grace window is for — the strict IoU pass has nothing to match
    (the box moved and the detector blinked), so `_near` decides.
    """
    t = IouTracker(ttl_s=2.0, grace_s=6.0)
    t.update([D('person', (284.0, 258.0, 1625.0, 1067.0))], now=0.0)
    t.update([], now=0.2)  # the detector blinked
    back = t.update([D('person', (900.0, 400.0, 1400.0, 1000.0))], now=0.4)

    assert [x.id for x in back] == [1]
    assert back[0].matched is True


def test_forget_retires_an_id_immediately():
    """A reported `leave` retires the id, so it is never reused by the next visit."""
    t = IouTracker()
    t.update([D('person', BOX)], now=0.0)
    t.forget(1)
    assert [x.id for x in t.update([D('person', BOX)], now=0.2)] == [2]
    assert 1 not in t._seen


def test_a_track_is_forgotten_after_the_grace():
    t = IouTracker(ttl_s=1.0, grace_s=1.0)
    t.update([D('person', BOX)], now=0.0)
    t.update([], now=0.5)
    late = t.update([D('person', BOX)], now=5.0)
    assert [x.id for x in late] == [2]
    # The expired id is dropped from the state, so a long-lived camera's tracker
    # cannot grow without bound.
    assert 1 not in t._seen


def test_two_people_keep_their_own_ids():
    t = IouTracker()
    first = t.update(
        [D('person', (0.0, 0.0, 50.0, 100.0)), D('person', (500.0, 0.0, 550.0, 100.0))],
        now=0.0,
    )
    moved = t.update(
        [
            D('person', (10.0, 0.0, 60.0, 100.0)),
            D('person', (490.0, 0.0, 540.0, 100.0)),
        ],
        now=0.2,
    )
    assert [x.id for x in first] == [1, 2]
    assert [x.id for x in moved] == [1, 2]


def test_two_detections_never_share_a_track():
    """Overlapping boxes: the better match keeps the id, the other opens one."""
    t = IouTracker()
    t.update([D('person', BOX)], now=0.0)
    both = t.update(
        [D('person', (0.0, 0.0, 90.0, 100.0)), D('person', (10.0, 0.0, 100.0, 100.0))],
        now=0.2,
    )
    assert sorted(x.id for x in both) == [1, 2]


def test_the_box_and_confidence_follow_the_detection():
    t = IouTracker()
    t.update([D('person', BOX, conf=0.4)], now=0.0)
    moved = t.update([D('person', (1.0, 1.0, 101.0, 101.0), conf=0.8)], now=0.2)
    assert moved[0].box == (1.0, 1.0, 101.0, 101.0)
    assert moved[0].conf == 0.8


def test_the_live_set_is_a_copy_not_the_trackers_own_list():
    """The caller carries the live set across frames: no shared mutation."""
    t = IouTracker()
    live = t.update([D('person', BOX)], now=0.0)
    live.append('x')
    assert [x.id for x in t.update([], now=0.2)] == [1]
