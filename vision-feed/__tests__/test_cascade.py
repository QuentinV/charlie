"""The loop's composition: cadence + tracker + policy together.

Nothing here needs a camera, a model or a brain — the pieces are the real ones
(`loop.detect_due`, `loop.look_fps`, `loop.policy_tracks`, `IouTracker`,
`PolicyEngine`), driven frame by frame the way `main.run_feed` drives them. It is the
guard for the symptoms the event log showed: an `enter`/`leave` pair per detection
cycle while a person stood still, a `dwell` that could never fire, a `leave` that
landed only once the motion gate happened to wake up on its own, and a stream hiccup
that minted a new id for someone who had not moved.

Two rules are part of the contract now, and both move a timestamp:

- an `enter` lands on the person's **first confirmed look** (`config.ENTER_CONFIRM_LOOKS`,
  `1`); the knob exists for a noisy detector, and the live trace is why it is not 2: a
  person reported once and then carried for 15+ frames stayed on `pending` and was never
  announced;
- an id is only retired at the end of the **re-association window**
  (`config.TRACK_GRACE_S`, 6 s), so a `leave` lands up to that long after the last
  detection — the price of not inventing a departure for someone who is still there.

The frames are 250 ms apart (an exact binary fraction, so the cadence arithmetic is
deterministic) and the detector runs every other frame (`detect_fps=2`), which is
what makes the miss handling observable.
"""
from dataclasses import dataclass

from pipeline.loop import detect_due, look_fps, policy_tracks
from pipeline.policy import PolicyEngine
from pipeline.track import IouTracker

FPS = 4.0
INTERVAL = 1.0 / FPS
BOX = (0.0, 0.0, 100.0, 100.0)
#: Overlaps `BOX` too little for the strict IoU rule (0.29) but is clearly the same
#: place: the box jump the live camera showed (a person sitting down, the detector
#: snapping from a partial to a full-body box).
JUMPED = (55.0, 0.0, 155.0, 100.0)
#: The shipped miss TTL (`config.MISS_TTL_S`).
MISS_TTL = 2.0
#: The shipped re-association window (`config.TRACK_GRACE_S`).
GRACE = 6.0
#: The shipped enter confirmation (`config.ENTER_CONFIRM_LOOKS`) — the first look.
CONFIRM_LOOKS = 1


@dataclass
class Detection:
    cls: str
    box: tuple
    conf: float = 0.9


def _run(
    seconds: float,
    present_from: float,
    present_to: float,
    detect_fps: float = 2.0,
    missed=(),
    jumps=(),
    gate_quiet_from=None,
    gate_quiet_to=None,
    gap_from=None,
    gap_to=None,
    miss_ttl: float = MISS_TTL,
    grace: float = GRACE,
    confirm_looks: int = CONFIRM_LOOKS,
):
    """Drive the loop's per-frame decisions; returns `(time, kind)` events.

    `missed` are detection frames where the detector finds nobody (a blink); `jumps`
    are frames where it finds them in a box that no longer overlaps the previous one
    (the live camera's id churn); `gate_quiet_from` / `gate_quiet_to` are when the
    motion gate stops and resumes reporting motion (a still person is absorbed into its
    background — the watchdog keeps looking, `loop.look_fps`); `gap_from` / `gap_to` are
    a **stream gap**: no frame is read at all, so the loop sits in its reopen branch and
    nothing looks.
    """
    tracker = IouTracker(ttl_s=miss_ttl, grace_s=grace)
    policy = PolicyEngine(
        classes={'person'},
        dwell_s=15.0,
        miss_ttl_s=miss_ttl,
        confirm_looks=confirm_looks,
    )
    events = []
    last_detect = -1e9
    live: list = []
    gap_open = False
    for i in range(int(seconds * FPS)):
        now = i * INTERVAL
        if gap_from is not None and gap_from <= now <= (gap_to or seconds):
            gap_open = True
            continue
        if gap_open:
            # Only the gate is rebuilt (`main.run_feed`); the tracks are frozen
            # across the outage so its TTL does not count as a departure.
            tracker.keep(live, now)
            gap_open = False

        present = present_from <= now <= present_to
        quiet = gate_quiet_from is not None and now >= gate_quiet_from
        if quiet and gate_quiet_to is not None and now >= gate_quiet_to:
            quiet = False
        # The gate: a burst unless we are in the quiet window (motion is what puts
        # the detector on the scene at all, `main.run_feed`).
        motion = not quiet

        # The burst rate inside a burst (`detect_fps` here, `config.DETECT_FPS` in
        # production), the watchdog rate in a room the gate calls quiet
        # (`loop.look_fps`) — never "believe them present and never look".
        detected = detect_due(now, last_detect, look_fps(motion, burst_fps=detect_fps))

        if detected:
            last_detect = now
            seen = present and round(now, 2) not in missed
            box = JUMPED if round(now, 2) in jumps else BOX
            live = tracker.update([Detection('person', box)] if seen else [], now)
            tracks = live
        else:
            tracks = policy_tracks(False, live)

        for ev in policy.update(now, tracks):
            if ev.kind == 'leave':
                tracker.forget(ev.track_id)
            events.append((round(now, 2), ev.kind))
    return events


def test_a_person_who_stays_enters_dwells_and_leaves_once():
    """The whole point: one `enter`, one `dwell`, one `leave` — no flapping."""
    events = _run(seconds=30.0, present_from=1.0, present_to=20.0)

    assert [kind for _, kind in events] == ['enter', 'dwell', 'leave']
    times = {kind: at for at, kind in events}
    # The first confirmed look, i.e. the first detection of the person (they are 0.5 s
    # apart here, 0.2 s in production).
    assert times['enter'] == 1.0
    assert times['dwell'] == 16.0  # 15 s after the *first* sighting
    # The leave lands at the end of the re-association window: the track is carried
    # (unconfirmed) for `TRACK_GRACE_S` after the last detection at 20.0, and the policy
    # reports the departure the moment the tracker drops it. That delay is the price of
    # never inventing a departure for someone who is still there.
    assert 26.0 < times['leave'] <= 27.0


def test_a_still_person_never_flaps_though_the_detector_blinks():
    """The report: standing still, the log showed `enter`/`leave`/`enter`.

    Two consecutive frames where the detector finds nobody are a blink, not a
    departure — the track is carried (unconfirmed) for the window, so the next
    detection matches it and no second id is minted.
    """
    events = _run(
        seconds=20.0,
        present_from=1.0,
        present_to=20.0,
        missed=(2.0, 2.5, 6.0),
    )

    kinds = [kind for _, kind in events]
    assert kinds.count('enter') == 1
    assert 'leave' not in kinds
    # ...and the person still dwells, at the same time as if nothing had blinked.
    assert events == [(1.0, 'enter'), (16.0, 'dwell')]


def test_a_still_person_in_a_silent_room_is_never_forgotten():
    """A still person is absorbed into the gate's background, so it stops asking.

    The watchdog keeps looking anyway (`loop.look_fps`): the track is re-confirmed
    about once a second, so it stays — and the dwell still fires — instead of ageing
    out on a clock nobody was watching.
    """
    events = _run(seconds=20.0, present_from=1.0, present_to=20.0, gate_quiet_from=5.0)

    assert events == [(1.0, 'enter'), (16.0, 'dwell')]


def test_a_departure_is_reported_though_the_room_goes_silent():
    """The report: "I leave and the event arrives a minute later".

    Once the gate went quiet nobody was looking — the old rule *believed* the track
    present and waited for the gate to wake up on its own, which could be minutes (or
    never, in a room that stayed still). The watchdog looks once a second, so the
    absence is confirmed and the `leave` lands at the end of the re-association window
    after the last real confirmation (8.0) — not after the gate's next burst.
    """
    events = _run(seconds=30.0, present_from=1.0, present_to=8.0, gate_quiet_from=9.0)

    assert [kind for _, kind in events] == ['enter', 'leave']
    leave = {at for at, kind in events if kind == 'leave'}.pop()
    assert 8.0 < leave <= 15.0


def test_an_empty_silent_room_produces_nothing():
    """No track, no motion: the watchdog still looks (1/s) and keeps finding nobody.

    Nobody is in frame at any point (`present_to=-1.0`), so the quiet gate is the only
    thing happening — and looking at an empty room must cost a slow tick, not events.
    """
    assert (
        _run(seconds=20.0, present_from=-1.0, present_to=-1.0, gate_quiet_from=1.0) == []
    )


def test_a_person_the_gate_never_sees_is_still_detected():
    """The live regression: the gate is quiet from the very first frame.

    That is someone who was already in the room when the feed started, or who sat
    down without tripping the gate — *no* motion burst ever happens. Gating the
    watchdog on "a track is already alive" meant nothing ever looked (`fps=0.0
    look=0` for 20 s of a person in front of the camera): no `enter`, and once they
    moved, a new id with the old `leave` in the same frame.
    """
    events = _run(seconds=20.0, present_from=1.0, present_to=20.0, gate_quiet_from=0.0)

    assert [kind for _, kind in events] == ['enter', 'dwell']
    # The watchdog's first look is the first frame the person is present on.
    assert events[0] == (1.0, 'enter')


def test_a_box_that_jumps_does_not_mint_a_new_id():
    """The live symptom, end to end: a new id per box jump.

    The strict IoU rule alone opened a new id as soon as the detector's box moved
    further than it overlapped, so one person standing there minted an id every couple
    of seconds — 422 `enter` / 418 `leave` in the log, the pair 17 ms apart. The
    tracker's re-association window (`TRACK_GRACE_S`) keeps the id, so the policy never
    sees a departure at all.
    """
    events = _run(seconds=30.0, present_from=1.0, present_to=20.0, jumps=(4.0, 8.0, 12.0))

    assert [kind for _, kind in events] == ['enter', 'dwell', 'leave']
    assert events[0] == (1.0, 'enter')


def test_a_stream_gap_does_not_mint_a_new_id_for_a_person_who_stayed():
    """The report: a one-second stream hiccup logged a second `enter`.

    A gap is "nobody looked", not a fresh room: only the gate is rebuilt, the tracks
    are frozen across the outage (`keep`), and the policy keeps its clocks — so
    someone standing there keeps their id *and* their dwell, and no `enter` is minted
    for a visit that never ended.
    """
    events = _run(seconds=30.0, present_from=1.0, present_to=20.0, gap_from=9.0, gap_to=11.0)

    kinds = [kind for _, kind in events]
    assert kinds.count('enter') == 1
    assert events[0] == (1.0, 'enter')
    assert (16.0, 'dwell') in events  # the visit was never interrupted
    assert kinds.count('leave') == 1


def test_a_stream_gap_does_not_swallow_the_leave_of_someone_who_left_during_it():
    """They left while the stream was down: the departure is still reported.

    The policy is not thrown away with the gate, so the frames after the resume (the
    track's window is counted from there) confirm the absence and the `leave` is posted
    — with no `enter` after it, since nobody came back.
    """
    events = _run(seconds=30.0, present_from=1.0, present_to=8.0, gap_from=9.0, gap_to=14.0)

    assert [kind for _, kind in events] == ['enter', 'leave']
    leave = {at for at, kind in events if kind == 'leave'}.pop()
    assert 14.0 <= leave <= 21.0


