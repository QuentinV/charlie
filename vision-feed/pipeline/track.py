"""Tier 2 — tracking: a dependency-free IoU tracker.

This file used to be `ByteTrackWrapper`: it imported `supervision` lazily and fell
back to a tiny IoU matcher. `supervision` 0.31.7 **removed the trackers**
(`sv.ByteTrack` raises `AttributeError`), so the fallback had silently become the
only tracker — while the dependency still pulled matplotlib, scipy, av and pillow
into the image. Measured at the loop's detection cadence (5/s, see `loop.py`), IoU
matching is enough for a home camera: a person's box overlaps from one detection
to the next at that rate.

**Two match windows, one id** (`config.MISS_TTL_S` / `config.TRACK_GRACE_S`):

- within the TTL, a detection continues a track if it is the **same class** and
  overlaps it above `iou_min` — the strict rule, and the window the policy needs as
  evidence for a `dwell`;
- beyond the TTL (and up to the grace window), a detection that no longer overlaps
  but is *in the same place* — same class, compatible size, centre within the box
  (`_near`) — **revives the id** instead of minting a new one.

The second window is what the live camera needed. With the strict rule alone, a box
that jumps (someone sitting down, a detector that blinks for more than the TTL, a
person who walks out of frame and back) opened a new id while the old one was still
carried, and the log showed 422 `enter` / 418 `leave` for one person standing in
front of the camera — the pair landing **17 ms** apart. Re-association costs a later
`leave` (a track is only dropped at the end of its grace window, and the policy
reports the departure then), which is the honest price of not inventing a departure
that never happened.

**`update` returns the live set, not just what the detector reported.** A track the
detector missed on this frame but that is still within its grace window comes back
with `matched=False`: it is *alive*, it simply was not confirmed. That distinction is
what lets the policy tell "the detector blinked" from "the person left" — hiding it
(returning only the matched tracks) was half of the enter/leave churn, the other
half being the loop replacing the policy's view with `[]` between two detections.

`keep()` is the third state: the loop tells the tracker its tracks are still
believed present across a **stream gap** — the source died or desynced, so nobody
looked for a while, and for longer than any window would survive. A gap is not
evidence of anything, so without it a person standing there through a one-second
outage would age out on wall-clock time and re-enter as a new id. A *quiet motion
gate* is the different case it used to cover, and it no longer uses this: the loop
keeps looking there (`loop.look_fps`, `config.QUIET_DETECT_FPS`), so belief is
replaced by evidence and a departure in a silent room can still be reported.
`forget()` retires an id the moment the policy reports its `leave`, so a `trackId` is
never reused across two `enter`s.
"""
import time
from dataclasses import dataclass

import config


@dataclass
class Track:
    id: int
    cls: str
    box: tuple
    conf: float
    #: True when the detector reported this track on the current frame; False on a
    #: track carried across a miss (alive, but unconfirmed).
    matched: bool = True


def _iou(a, b) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union > 0 else 0.0


def _scale(a, b) -> float:
    """How compatible two boxes are in size: their larger dimensions, ratio'd.

    The larger dimension is the object's scale, and it is the stable one: measured on a
    live 1080p person, walking away collapsed the **width** from 1341 px to 780 px while
    the height barely moved (809 → 860 px, the person standing up). A per-dimension test
    rejected that match and minted a new id; a scale test does not.
    """
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    sa = max(ax2 - ax1, ay2 - ay1)
    sb = max(bx2 - bx1, by2 - by1)
    if sa <= 0 or sb <= 0:
        return 0.0
    return min(sa, sb) / max(sa, sb)


def _near(a, b, centre_frac: float, size_frac: float) -> bool:
    """Two boxes of the same class *in the same place* — a re-association.

    Used only when the strict IoU pass found nothing: the detection is then either a
    person whose box jumped (they sat down; the detector snapped from a partial to a
    full-body box) or a different thing entirely. Scale and distance together decide: a
    box three times the size is not the same thing, and a centre further away than
    `centre_frac` of the box is not the same place.
    """
    if _scale(a, b) < size_frac:
        return False
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    reach = centre_frac * max(ax2 - ax1, ay2 - ay1, bx2 - bx1, by2 - by1)
    return _centre_gap(a, b) <= reach


def _centre_gap(a, b) -> float:
    """Centre distance of two boxes (the tie-break between two candidates)."""
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    dx = (ax1 + ax2) / 2 - (bx1 + bx2) / 2
    dy = (ay1 + ay2) / 2 - (by1 + by2) / 2
    return (dx * dx + dy * dy) ** 0.5


class IouTracker:
    """Keeps an id on a detection that overlaps a recent one of the same class.

    `ttl_s` is the strict window (IoU matching, and the policy's evidence window);
    `grace_s` is the re-association window — an id is carried (and matchable by
    proximity) for that long before it is retired. `grace_s` is clamped to at least
    `ttl_s`: a shorter grace would retire an id the policy still believes in, so a
    revival would come back as a *new* visit carrying the *same* id.
    """

    def __init__(
        self,
        iou_min: float = 0.3,
        ttl_s: float = None,
        grace_s: float = None,
        centre_frac: float = None,
        size_frac: float = None,
    ):
        self.iou_min = iou_min
        self.ttl_s = config.MISS_TTL_S if ttl_s is None else ttl_s
        self.grace_s = max(
            config.TRACK_GRACE_S if grace_s is None else grace_s, self.ttl_s
        )
        self.centre_frac = (
            config.TRACK_CENTRE_FRAC if centre_frac is None else centre_frac
        )
        self.size_frac = config.TRACK_SIZE_FRAC if size_frac is None else size_frac
        self._next_id = 1
        self._prev: list[Track] = []
        self._seen: dict[int, float] = {}

    def update(self, detections, now: float = None) -> list[Track]:
        """Match one frame's detections; returns the **live set**.

        Matched tracks carry `matched=True`; a track nobody matched but that is
        still within `ttl_s` is carried over from its last known box with
        `matched=False` (see the module docstring).
        """
        now = time.monotonic() if now is None else now
        # A track nobody matched for `grace_s` is gone and must not become matchable
        # again: that is what makes a re-entry a *new* id, so the policy can report a
        # `leave` and then an `enter`.
        self._forget(now)

        matched: list[Track] = []
        taken: set[int] = set()
        for d in detections:
            best, best_iou = None, self.iou_min
            for t in self._prev:
                if t.id in taken or t.cls != d.cls:
                    continue
                i = _iou(d.box, t.box)
                if i > best_iou:
                    best, best_iou = t, i
            if best is None:
                # No overlap: the strict pass failed. Before opening a new id, ask
                # whether a track is *in the same place* — the re-association that
                # keeps a jumping box (or a person who walked out and back) on its id.
                best = self._revive(d, taken)
            if best is not None:
                taken.add(best.id)
                matched.append(Track(best.id, d.cls, d.box, d.conf))
            else:
                matched.append(Track(self._next_id, d.cls, d.box, d.conf))
                self._next_id += 1
            self._seen[matched[-1].id] = now

        # Carried tracks: alive (within the grace window) but unconfirmed this frame.
        # Their box stays the last one the detector gave — which is what the next
        # detection is matched against, so a person standing still keeps their id.
        matched_ids = {t.id for t in matched}
        carried = [
            Track(t.id, t.cls, t.box, t.conf, matched=False)
            for t in self._prev
            if t.id not in matched_ids
        ]
        self._prev = matched + carried
        return list(self._prev)

    def _revive(self, detection, taken: set[int]):
        """The closest track of the same class in the same place, or None.

        Only the tracks the strict pass did not already claim (`taken`) are candidates,
        and the closest one wins, so two nearby people cannot swap ids.
        """
        best, best_gap = None, None
        for t in self._prev:
            if t.id in taken or t.cls != detection.cls:
                continue
            if not _near(detection.box, t.box, self.centre_frac, self.size_frac):
                continue
            gap = _centre_gap(detection.box, t.box)
            if best_gap is None or gap < best_gap:
                best, best_gap = t, gap
        return best

    def keep(self, tracks, now: float = None) -> None:
        """Freeze the TTL of tracks nobody could have looked at (a stream gap).

        Called once when a dead source is reopened: there is no evidence either
        way across the gap, so the tracks must not age out during it — and the
        policy, which was not called either, keeps its own clocks. A quiet motion
        gate is **not** this case: the loop keeps looking there (`loop.look_fps`).
        """
        now = time.monotonic() if now is None else now
        for t in tracks or ():
            if t.id in self._seen:
                self._seen[t.id] = now

    def forget(self, track_id: int) -> None:
        """Retire an id (the policy reported its `leave`): it is never reused."""
        self._prev = [t for t in self._prev if t.id != track_id]
        self._seen.pop(track_id, None)

    def _forget(self, now: float) -> None:
        """Drop the tracks not matched for `grace_s` (keeps the state bounded).

        The window is the **re-association** one, not the strict TTL: a track the
        policy still believes in must stay matchable, or a revival would come back as a
        new visit carrying the same id.
        """
        self._prev = [
            t
            for t in self._prev
            if now - self._seen.get(t.id, now) <= self.grace_s
        ]
        self._seen = {
            t.id: self._seen[t.id] for t in self._prev if t.id in self._seen
        }

