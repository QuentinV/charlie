"""The motion rules: the signs a single frame cannot express. Pure: no mediapipe, no I/O.

A short trajectory of the palm (`MOTION_WINDOW_S`, ~0.8 s) turns the same landmarks the
static rules read into:

- `Swipe_Left/Right/Up/Down` — a fast, mostly **straight** displacement of at least
  `min_travel` palm scales (a small wobble is not a swipe, and a slow drift is not one
  either: the whole window has to fit inside `MOTION_WINDOW_S`);
- `Wave` — a lateral direction that **reverses** at least twice with a real amplitude (a
  hand that changes its mind; the canned vocabulary has no wave at all — see the
  `commands` hint in `cameras/modes.ts`);
- `Push` / `Pull` — the palm moving towards / away from the camera. Depth is read from
  the **apparent size** of the palm, never from a landmark's z: MediaPipe's image z is
  wrist-relative (the wrist *is* the origin, so it says nothing about distance) and its
  world landmarks are hand-centric. A monocular image's honest depth cue is "the hand got
  bigger", which is exactly what a push looks like.

Association is by **handedness** (the landmark list carries no hand id), one track per
hand label; the vocabulary's motion names are one-handed on purpose.

A fired trajectory is **consumed** (its window restarts): one swipe is one event, not one
per frame while the window still holds the travel. A *repeated* sign is de-duplicated by
`GestureGate`'s cooldown, never here.

Thresholds are calibrated on recorded frames (`recorder.py` + `probe_gestures.py`).
"""
import math
from dataclasses import dataclass

import config

from pipeline.hands import WRIST

#: A step smaller than this (÷ palm scale) is jitter, not a direction change — the
#: reversal counter ignores it, so a hand held still cannot look like a wave.
JITTER_FRAC = 0.10
#: Net displacement ÷ path length at or above which a trajectory is "straight" (a swipe
#: rather than a wave).
MIN_STRAIGHT = 0.60
#: Relative palm-size change that counts as a push/pull (the depth cue).
DEPTH_RATIO = 0.25


@dataclass
class MotionSample:
    """One frame's palm, in the units the rules compare: image x/y + palm size."""

    at: float
    x: float
    y: float
    scale: float


def _sample(hand, now: float) -> MotionSample:
    palm = hand.point(WRIST)
    return MotionSample(now, palm[0], palm[1], hand.palm_scale)


def _path_length(samples) -> float:
    return sum(
        math.hypot(
            samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y
        )
        for i in range(1, len(samples))
    )


def _swipe(samples, min_travel: float) -> str | None:
    """The direction name of a straight, fast displacement, or None."""
    first, last = samples[0], samples[-1]
    dx, dy = last.x - first.x, last.y - first.y
    travel = math.hypot(dx, dy)
    if travel < min_travel * first.scale:
        return None
    path = _path_length(samples)
    if path <= 0 or travel / path < MIN_STRAIGHT:
        return None  # a back-and-forth (a wave), not a swipe
    if abs(dx) > abs(dy):
        return 'Swipe_Right' if dx > 0 else 'Swipe_Left'
    return 'Swipe_Down' if dy > 0 else 'Swipe_Up'


def _wave(samples, amplitude: float) -> bool:
    """True when the lateral axis reverses at least twice with a real amplitude."""
    scale = samples[0].scale
    steps = [samples[i].x - samples[i - 1].x for i in range(1, len(samples))]
    steps = [step for step in steps if abs(step) >= JITTER_FRAC * scale]
    if len(steps) < 3:
        return False
    reversals = sum(
        1
        for i in range(1, len(steps))
        if (steps[i] > 0) != (steps[i - 1] > 0)
    )
    if reversals < 2:
        return False
    span = max(s.x for s in samples) - min(s.x for s in samples)
    return span >= amplitude * scale


def _depth(samples) -> str | None:
    """`Push` when the palm grew, `Pull` when it shrank (the apparent-size cue)."""
    first, last = samples[0].scale, samples[-1].scale
    if first <= 0:
        return None
    ratio = last / first
    if ratio >= 1.0 + DEPTH_RATIO:
        return 'Push'
    if ratio <= 1.0 / (1.0 + DEPTH_RATIO):
        return 'Pull'
    return None


class MotionTracker:
    """Per-hand ring of palm samples → the motion names its trajectory spells."""

    def __init__(
        self,
        window_s=None,
        min_travel=None,
        min_samples=None,
        wave_amplitude=None,
    ):
        self.window_s = (
            config.GESTURE_MOTION_WINDOW_S if window_s is None else window_s
        )
        self.min_travel = (
            config.GESTURE_MOTION_MIN_TRAVEL if min_travel is None else min_travel
        )
        self.min_samples = (
            config.GESTURE_MOTION_MIN_SAMPLES
            if min_samples is None
            else min_samples
        )
        self.wave_amplitude = (
            config.GESTURE_MOTION_WAVE_AMPLITUDE
            if wave_amplitude is None
            else wave_amplitude
        )
        self._tracks: dict = {}

    def update(self, hands, now: float) -> list:
        """Feed one frame's hands; return the motion names their trajectories spell."""
        for samples in self._tracks.values():
            samples[:] = [s for s in samples if now - s.at <= self.window_s]

        names = []
        for hand in hands or ():
            key = hand.handedness or 'hand'
            samples = self._tracks.setdefault(key, [])
            samples.append(_sample(hand, now))
            if len(samples) < self.min_samples:
                continue
            if _wave(samples, self.wave_amplitude):
                name = 'Wave'
            else:
                name = _swipe(samples, self.min_travel) or _depth(samples)
            if name is None:
                continue
            names.append(name)
            # Consume the trajectory: the window restarts, so one swipe is one event.
            samples.clear()
        return names

    def forget(self, hands, now: float) -> None:
        """Drop the tracks no hand matches, once their window has passed.

        Not on the first miss: a hand MediaPipe loses for a single frame is the
        same trajectory, and deleting its track there shredded a swipe whose whole
        travel has to fit inside the window. A hand that really left loses its
        samples by falling out of the window, and the key goes with them, so a later
        hand starts a new trajectory.
        """
        alive = {hand.handedness or 'hand' for hand in hands or ()}
        for key in list(self._tracks):
            samples = self._tracks[key]
            newest = samples[-1].at if samples else None
            if key in alive:
                continue
            if newest is None or now - newest > self.window_s:
                del self._tracks[key]
