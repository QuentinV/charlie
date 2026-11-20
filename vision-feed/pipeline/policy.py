"""Tier 2 → events — turn tracks into semantic events.

Pure (stdlib only) so the rules are exhaustively unit-testable: given the tracks
seen this frame and a clock, it emits `enter` / `dwell` / `leave` events for the
classes the camera's modes care about. No I/O, no model.

The policy is **per class** (`dwell_by_class`), because one camera may run
several modes at once: `entrance` (3 s) and `presence` (15 s) both watch
`person`, and the shortest dwell is the one the brain resolved for that class.
One engine per camera — never one per mode.

Two rules keep the event stream honest, and both were added because the live log
showed they were missing:

- an `enter` needs `confirm_looks` **confirmed** frames (default 2). One frame is not
  evidence of a visit: a single false detection announced someone and then took the id
  away two seconds later — an `enter`/`leave` pair for a ghost. The count never resets
  on a miss (a detector that blinks must not postpone the enter forever), and a track
  that never reaches it is dropped in **silence**: reporting a `leave` for a visit
  nobody was ever told about is the phantom half of the same churn.
- a `track` is any object with `id` (int) and `cls` (str) — the detector/tracker
  produce richer objects, the policy only reads those two fields.
"""
from dataclasses import dataclass, field
from typing import Iterable, Optional

import config


@dataclass
class Event:
    kind: str  # 'enter' | 'dwell' | 'leave'
    track_id: int
    cls: str
    at: float  # seconds (monotonic)
    dwell_s: Optional[float] = None


@dataclass
class _TrackState:
    cls: str
    first: float
    last: float
    dwelled: bool = False
    #: Confirmed (`matched`) frames seen so far — the `enter` evidence counter.
    looks: int = 1
    #: True once the `enter` was announced (a `leave` is only ever reported for it).
    entered: bool = False


@dataclass
class PolicyEngine:
    #: classes that count as interesting (empty = everything).
    classes: Iterable[str] = field(default_factory=tuple)
    #: per-class dwell (`{'person': 3}`); a class with no row uses `dwell_s`.
    dwell_by_class: dict = field(default_factory=dict)
    dwell_s: float = 15.0
    miss_ttl_s: float = 1.0
    #: Confirmed frames a track needs before it is worth an `enter` (`1` = the first
    #: look). The default is the **shipped knob**, not a copy of it: `main._cascade`
    #: passes it explicitly, so a `VISION_ENTER_CONFIRM_LOOKS` change applies when the
    #: feed restarts — and a library default that silently disagreed with `config` is
    #: exactly the bug this line prevents.
    confirm_looks: int = config.ENTER_CONFIRM_LOOKS

    def __post_init__(self):
        self.classes = set(self.classes)
        self.dwell_by_class = {
            str(cls): float(value)
            for cls, value in (self.dwell_by_class or {}).items()
            if isinstance(value, (int, float)) and value > 0
        }
        self.confirm_looks = max(1, int(self.confirm_looks))
        self._active: dict[int, _TrackState] = {}

    def _interesting(self, cls: str) -> bool:
        return not self.classes or cls in self.classes

    def dwell_for(self, cls: str) -> float:
        """The dwell of one class: its own row, else the feed's default."""
        return self.dwell_by_class.get(cls, self.dwell_s)

    def update(self, now: float, tracks) -> list[Event]:
        """Feed the tracks of the current frame; return the events they imply.

        `tracks is None` means **the detector did not look at this frame**: no
        information, *not* an empty room. No `leave` can fire (a frame nobody looked
        at is not evidence that everyone left, and treating it as one was the
        enter/leave churn), and a `dwell` still comes out of it as long as the track
        has been confirmed within the TTL — a person standing still through a quiet
        gate keeps dwelling, because the watchdog is looking at them (`_dwell_events`).

        The miss clock is **not** reset either: `state.last` only ever moves on a
        confirmation, so a track that has been unconfirmed for longer than
        `miss_ttl_s` is retired by the first authoritative frame that finds nobody.
        Resetting it on a no-information frame would freeze the clock and delay a
        real departure until the *next* burst lasts the whole TTL.

        Only a **matched** track refreshes `state.last`: a track carried across a
        miss is alive but unconfirmed, so it must not push its own `leave` further
        away than the tracker's TTL.
        """
        events: list[Event] = []

        if tracks is None:
            for tid, state in self._active.items():
                events.extend(self._dwell_events(tid, state, now))
            return events

        seen: set[int] = set()
        for t in tracks:
            tid = int(t.id)
            cls = str(t.cls)
            if not self._interesting(cls):
                continue
            seen.add(tid)
            matched = bool(getattr(t, 'matched', True))

            state = self._active.get(tid)
            if state is None:
                state = self._active[tid] = _TrackState(
                    cls, now, now, looks=1 if matched else 0
                )
            elif matched:
                # Only a **matched** track is evidence: a carried one is alive but
                # unconfirmed, so it neither moves the clock nor counts as a look.
                state.looks += 1
                state.last = now

            if not state.entered:
                # `confirm_looks` confirmed frames, or it is not a visit yet.
                if state.looks >= self.confirm_looks:
                    state.entered = True
                    events.append(Event('enter', tid, cls, now))
                continue

            events.extend(self._dwell_events(tid, state, now))

        # A track not seen for `miss_ttl_s` has left.
        for tid, state in list(self._active.items()):
            if tid in seen:
                continue
            if now - state.last >= self.miss_ttl_s:
                if state.entered:
                    events.append(Event('leave', tid, state.cls, now))
                # A track that never reached the enter confirmation is dropped in
                # silence: a `leave` for a visit nobody was ever told about is the
                # phantom half of the enter/leave churn.
                del self._active[tid]

        return events

    def pending(self) -> dict:
        """Tracks still short of their `enter` confirmation, as `{track_id: looks}`.

        For the debug UI and the trace: an `enter` that has not fired yet is what a
        person watching the live view needs to tell apart from a camera that is blind.
        """
        return {
            tid: state.looks
            for tid, state in self._active.items()
            if not state.entered
        }

    def snapshot(self, now: float) -> dict:
        """Every track the policy knows: `{track_id: {cls, ageS, looks, entered}}`."""
        return {
            tid: {
                'cls': state.cls,
                'ageS': round(now - state.first, 1),
                'looks': state.looks,
                'entered': state.entered,
            }
            for tid, state in self._active.items()
        }

    def _dwell_events(self, tid: int, state: _TrackState, now: float) -> list[Event]:
        """The `dwell` event a track's age implies — at most once per track.

        A `dwell` means "they are **still here**", so it needs recent evidence: a
        track nobody has confirmed for longer than `miss_ttl_s` is on its way out
        (`state.last` only moves on a confirmation), and the wall clock alone — a
        stream gap counts towards it — must not turn an empty room into a lingering
        presence. The `presence` mode escalates a `dwell`, i.e. a VLM call on nobody.
        With the watchdog (`loop.look_fps`) a quiet gate is confirmed about once a
        second, so this delays a legitimate dwell by a fraction of a second at most.
        """
        if state.dwelled:
            return []
        if now - state.last > self.miss_ttl_s:
            return []
        age = now - state.first
        if age < self.dwell_for(state.cls):
            return []
        state.dwelled = True
        return [Event('dwell', tid, state.cls, now, dwell_s=age)]
