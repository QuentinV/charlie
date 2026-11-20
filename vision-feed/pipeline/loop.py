"""The feed loop's cadence decisions, as pure functions.

Four rules decide whether a track ever flaps and whether a camera survives a bad
minute, and all of them live here so they can be tested without a camera, a model or
a brain:

- `detect_due` — **when** the detector may run inside a motion burst. This used to
  be a 2 s cooldown (`VISION_FEED_COOLDOWN_MS`) which also gated the gesture tier:
  the recognizer was asked 0.5 times a second (mean wait 1000 ms), so a wave was
  frequently never sampled at all.
- `look_fps` — **how often** the detector may run at all: the burst rate, or the
  watchdog rate a quiet gate is looked at with — always, whatever the tracks say. A
  quiet gate is not an empty room (a person standing still is absorbed into its
  background in ~2-4 s), and gating this on "a track is already alive" left the
  camera blind exactly when it mattered: the track expired, the detector stopped
  looking altogether, and the person was re-detected as a *new* id the moment they
  moved again.
- `policy_tracks` — **what the policy is told** between two detections: `None`,
  meaning "the detector did not look", never `[]`. `[]` means the detector looked
  and saw nobody, which is what starts the miss clock; conflating the two was the
  enter/leave churn.
- `feeds_to_stop` — **which cameras to stop** after a poll, with the one case that
  matters: an unanswered poll stops nothing at all.

The gesture tier is deliberately **absent** from this list: the recognizer is asked
on every frame the loop reads (`main.py`), not on a schedule of its own. Its
`VIDEO` mode carries a landmark tracker across calls, so a sparse cadence does not
delay its answer, it destroys it — at 1/s it reported a hand and no gesture *every
time*, where the same frames at the loop's own rate classified the sign
(`Victory 0.50-0.71` for 24 consecutive frames). It is also the cheapest tier of the
cascade (24.7 ms/frame against the detector's 156 ms), so a rate knob here was
rationing the wrong thing; `gesture.GestureGate` — not the sampler — is what keeps a
wave from flooding the bus.
"""
import config


def detect_due(now: float, last_detect: float, detect_fps: float = None) -> bool:
    """True when the detector may run again.

    `detect_fps` is a ceiling, not a schedule: the loop only asks once per frame
    it read, so the real rate is `min(detect_fps, frames per second)`.
    """
    fps = config.DETECT_FPS if detect_fps is None else detect_fps
    if fps <= 0:
        return False
    return (now - last_detect) >= 1.0 / fps


def look_fps(motion: bool, burst_fps: float = None, quiet_fps: float = None) -> float:
    """The detector's cadence: the burst rate, or the quiet-room watchdog rate.

    A quiet gate is **not** an empty room. The gate answers "did a lot of pixels
    change", and a person who is present but still stops tripping it within seconds —
    so the detector has to keep looking anyway, at `QUIET_DETECT_FPS` (1/s), whatever
    the tracks say.

    Gating that on "a track is already alive" is the trap this replaces, and it is
    what the live camera showed: the moment a track expired (2 s without a detection)
    — or on a feed that starts with someone already in frame, so no motion ever
    tripped the gate — the detector stopped looking **entirely** (`fps=0.0 look=0`
    for 20 s of a person sitting in front of the camera). The person was invisible
    until they moved, and then re-detected as a NEW id, so the old `leave` and the new
    `enter` landed in the same frame: the enter/leave churn, with a fresh id every
    couple of seconds.

    Cost of looking always: one detection per second is ~43-51 ms, i.e. ~5% of one
    core in an empty room. That is the price of `presence` meaning anything at all.
    """
    if motion:
        return config.DETECT_FPS if burst_fps is None else burst_fps
    return config.QUIET_DETECT_FPS if quiet_fps is None else quiet_fps


def policy_tracks(detected_now: bool, live_tracks) -> list | None:
    """The tracks the policy sees on this frame — or `None` for "not looked".

    A frame where the detector did not run is **no information**: it is not an
    empty room (the policy would start its miss clock and report a `leave`), and it
    is not the previous frame's tracks either — the tracker already carries those
    across a miss and marks them unconfirmed (`track.py`). `None` is the one honest
    answer, and the policy is written to treat it as such.
    """
    return list(live_tracks) if detected_now else None


def feeds_to_stop(previous_ids, wanted_ids, answered: bool) -> set:
    """Which feeds to stop — nothing at all when the brain did not answer.

    `None` from `brain.fetch_feeds` means "the brain did not answer": the camera
    selection is *unknown*, not empty. Treating it as empty stopped every camera for
    the length of a brain restart — and each one re-paid its detector and recognizer
    load on the way back, for a blip that lasted a second. An answered poll is
    authoritative instead: a camera no longer selected is stopped, a new one starts.
    """
    if not answered:
        return set()
    return {cid for cid in previous_ids if cid not in wanted_ids}


def frame_sleep(worked_s: float, fps: float) -> float:
    """How long to wait so one iteration lasts `1/fps` (never negative)."""
    if fps <= 0:
        return 0.0
    return max(0.0, 1.0 / fps - worked_s)
