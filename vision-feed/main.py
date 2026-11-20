"""Run the cascade on a live source, print events + timings.

    python main.py --source webcam
    python main.py --source webcam --headless --seconds 30

No brain, no Docker: this is the measurement harness. For the same cascade with
live boxes and a mocked brain, see `debug.py`; `--brain` is the container's mode,
which polls the brain for the cameras it should watch.
"""
import argparse
import time

import brain
import config
from pipeline import observe
from pipeline.detect import Detector
from pipeline.escalate import escalate_keyframe
from pipeline.gate import MotionGate
from pipeline.gesture import GestureDetector, GestureGate, GestureVote
from pipeline.loop import (
    detect_due,
    feeds_to_stop,
    frame_sleep,
    look_fps,
    policy_tracks,
)
from pipeline.policy import PolicyEngine
from pipeline.poster import EventPoster
from pipeline.sources import feed_source, open_feed, open_source
from pipeline.track import IouTracker


def _gray(frame):
    import cv2

    return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)


def run(
    source_spec: str,
    headless: bool = False,
    seconds=None,
    gate_only: bool = False,
):
    source = open_source(source_spec)
    gate = MotionGate(
        config.GATE_WIDTH,
        config.GATE_HEIGHT,
        config.GATE_THRESHOLD,
        config.GATE_CELL_MIN,
        config.GATE_MAX_HOT_FRACTION,
        warmup=config.GATE_WARMUP,
    )
    # `--gate-only` measures Tier 0 alone (no torch/ultralytics needed).
    detector = None if gate_only else Detector()
    tracker = None if gate_only else IouTracker()
    policy = PolicyEngine(
        classes=(), dwell_s=config.DWELL_S, miss_ttl_s=config.MISS_TTL_S
    )

    started = time.monotonic()
    cpu_started = time.process_time()
    last_detect = 0.0
    tracks: list = []
    gate_ms = detect_ms = 0.0
    n_gate = n_detect = 0
    try:
        while True:
            frame = source.read()
            if frame is None:
                break
            now = time.monotonic()
            if seconds and now - started >= seconds:
                break

            t0 = time.perf_counter()
            motion = gate.update(_gray(frame))
            gate_ms += (time.perf_counter() - t0) * 1000
            n_gate += 1

            detected = bool(
                detector and detect_due(now, last_detect, look_fps(motion.motion))
            )
            if detected:
                last_detect = now
                t1 = time.perf_counter()
                tracks = tracker.update(detector.detect(frame), now)
                detect_ms += (time.perf_counter() - t1) * 1000
                n_detect += 1

            for ev in policy.update(now, policy_tracks(detected, tracks)):
                dwell = f' dwell={ev.dwell_s:.1f}s' if ev.dwell_s else ''
                print(f'[{ev.kind}] {ev.cls} track={ev.track_id}{dwell}')
                if ev.kind == 'leave' and tracker is not None:
                    tracker.forget(ev.track_id)

            if not headless:
                _draw(frame, tracks, motion)
            time.sleep(frame_sleep(time.monotonic() - now, config.IDLE_FPS))
    finally:
        source.close()

    wall = max(1e-6, time.monotonic() - started)
    cpu = (time.process_time() - cpu_started) / wall * 100
    print(
        f'gate {n_gate} frames, {gate_ms / max(1, n_gate):.2f} ms/frame; '
        f'detect {n_detect} frames, {detect_ms / max(1, n_detect):.2f} ms/frame; '
        f'cpu {cpu:.1f}% of one core'
    )


def _draw(frame, tracks, motion) -> None:
    """The laptop preview window — the **same** annotation the debug UI shows.

    `pipeline.observe` owns the drawing (`annotate`), so the boxes a person sees here
    and the boxes `debug.py` streams cannot drift apart.
    """
    import cv2

    stats = observe.FrameStats(
        at=time.monotonic(),
        wall=time.time(),
        frame_no=0,
        fps=0.0,
        motion=motion.motion,
        gate_score=motion.score,
        detected=True,
        tracks=observe.tracks_of(tracks),
    )
    cv2.imshow('vision-feed', observe.annotate(frame, stats, copy=False))
    cv2.waitKey(1)


def _gate():
    """A fresh motion gate: the one piece of state a stream gap invalidates.

    Its background model is learned from the frames it saw, so after a gap every
    pixel looks like motion (a burst of false events) — it is rebuilt, while the
    tracker and the policy survive (`_cascade`).
    """
    return MotionGate(
        config.GATE_WIDTH,
        config.GATE_HEIGHT,
        config.GATE_THRESHOLD,
        config.GATE_CELL_MIN,
        config.GATE_MAX_HOT_FRACTION,
        warmup=config.GATE_WARMUP,
    )


def _pending(source) -> int:
    """Bytes the source's transport still holds unread (`FrameSource.pending`).

    0 for any source that cannot say — including a test double without the method — so
    the field is a reading, never a guess.
    """
    fn = getattr(source, 'pending', None)
    return int(fn()) if callable(fn) else 0


def _cascade(policy_cfg, gate=None, tracker=None, policy=None):
    """The gate + tracker + policy of one feed, rebuilt only where it must be.

    Called with no arguments for a fresh feed. After a stream gap the caller passes
    the **tracker and the policy back in** and lets the gate be rebuilt: a gap is
    "nobody looked", not a fresh room. Dropping them (what this used to do) minted a
    new id for a person who never left — an `enter` for a visit that never ended —
    and swallowed the `leave` of someone who *did* leave during the gap, because the
    policy that was about to report it had been thrown away.
    """
    if gate is None:
        gate = _gate()
    if tracker is None:
        tracker = IouTracker()
    if policy is None:
        policy = PolicyEngine(
            classes=policy_cfg.get('classes') or (),
            dwell_by_class=policy_cfg.get('dwellByClass') or {},
            dwell_s=config.DWELL_S,
            miss_ttl_s=config.MISS_TTL_S,
            # One frame is not a visit: a single false detection must not announce
            # someone and then take the id away two seconds later (`policy.py`).
            confirm_looks=config.ENTER_CONFIRM_LOOKS,
        )
    return gate, tracker, policy


def run_feed(feed, stop, sink=None, observer=None):
    """Run the cascade for one brain feed until `stop` is set, posting events.

    `sink` is where events go (`brain.post_event` by default) and `observer` is called
    once per iteration with `(frame, observe.FrameStats)` — the one hook the
    `VISION_DEBUG` trace and `debug.py`'s live UI both use. Both are optional and
    neither changes what the cascade decides.
    """
    camera_id = feed.get('cameraId')
    policy_cfg = feed.get('policy') or {}
    # A relayed feed is opened on the brain (see `feed_source`): the camera may
    # live on the brain's host, which this container cannot reach.
    source_spec = feed_source(feed, config.BRAIN_URL, config.brain_token())
    try:
        source = open_feed(source_spec)
    except Exception as e:  # noqa: BLE001
        print(f'[feed {camera_id}] could not open source: {e}')
        return

    gate, tracker, policy = _cascade(policy_cfg)
    detector = Detector()
    # Escalation and gestures are per class / per camera: a `pet` camera must not
    # pay a VLM call, and only a camera whose modes ask for gestures loads the
    # recognizer at all.
    escalate_classes = {
        str(cls) for cls in (policy_cfg.get('escalateClasses') or ())
    }
    gesture_modes = [str(m) for m in (policy_cfg.get('gestureModes') or ())]
    modes_by_class = policy_cfg.get('modesByClass') or {}

    gestures = None
    if gesture_modes:
        candidate = GestureDetector()
        reason = candidate.unavailable_reason()
        if reason is None:
            gestures = candidate
            # A tier that runs but is configured in a way worth knowing about (a
            # trained classifier the table does not declare) says so once, here.
            if candidate.note:
                print(f'[feed {camera_id}] {candidate.note}')
        else:
            print(f'[feed {camera_id}] gestures requested but {reason}')
    gesture_gate = GestureGate()
    # A gesture is decided by a **vote** (`gesture.GestureVote`), not by the model's
    # score on one frame: the score wanders (a held `Victory` measured 0.50-0.71), and
    # a floor low enough to see the sign is low enough to publish a hand passing
    # through the frame. `gesture_gate` then de-duplicates a sign held for longer.
    gesture_vote = GestureVote()
    print(
        f'[feed {camera_id}] watching {feed.get("name")} '
        f'({source_spec.get("kind")})'
    )
    poster = EventPoster(
        sink or brain.post_event,
        escalate=lambda f: escalate_keyframe(f, config.DESCRIBE_PROMPT),
    )
    last_detect = 0.0
    live_tracks: list = []
    backoff = config.REOPEN_MIN_S
    # --- debug bookkeeping (only read when `observer`/`VISION_DEBUG` is on) ---
    frame_no = 0
    known_ids: set[int] = set()
    last_trace = 0.0
    fps = 0.0
    fps_frames = 0
    fps_since = time.monotonic()
    try:
        while not stop.is_set():
            frame = source.read()
            if frame is None:
                # A dead stream must not spin at full speed — and it must not stay
                # dead: reopen with a growing backoff, capped at a couple of seconds
                # (`config.REOPEN_MAX_S`). A relayed MJPEG stream (the brain's
                # passthrough, `sources.MjpegSource`) or a loopback webcam helper is
                # back in milliseconds, so the old 30 s ladder turned a one-second
                # hiccup into half a minute of blindness.
                source.close()
                time.sleep(backoff)
                backoff = min(backoff * 2, config.REOPEN_MAX_S)
                try:
                    source = open_feed(source_spec)
                    # A gap is "nobody looked", not a fresh room: only the gate is
                    # rebuilt (its background model is stale, so every pixel would
                    # look like motion), while the tracker and the policy carry on.
                    # `keep` freezes the tracks' TTL across the outage, so someone who
                    # stood there keeps their id — no phantom `enter` — and someone who
                    # left during it is still reported, one TTL after the resume.
                    gate = _gate()
                    tracker.keep(live_tracks, time.monotonic())
                    print(f'[feed {camera_id}] stream reopened')
                except Exception as e:  # noqa: BLE001
                    print(f'[feed {camera_id}] reopen failed: {e}')
                continue
            backoff = config.REOPEN_MIN_S
            now = time.monotonic()
            motion = gate.update(_gray(frame))

            # The detector runs at its own cadence (5/s by default) inside a burst —
            # and, on a gate that has gone quiet, as a **watchdog** at
            # `VISION_QUIET_DETECT_FPS` (`loop.look_fps`), always. A person standing
            # still is absorbed into the gate's background in ~2-4 s, and believing
            # them present without ever looking (what this used to do) meant a real
            # departure in a silent room was reported only when the gate happened to
            # wake up on its own. Making that watchdog conditional on "a track is
            # already alive" (measured live) was worse: the track expires after 2 s,
            # the detector stops looking altogether, and the person is re-detected as
            # a new id the moment they move again — `leave` and `enter` in the same
            # frame, with a fresh id every couple of seconds. A frame the detector did
            # not look at carries **no information**: the policy is told `None`, never
            # "nobody is there" (`loop.policy_tracks`).
            detected = detect_due(now, last_detect, look_fps(motion.motion))
            detections: list = []
            if detected:
                last_detect = now
                detections = detector.detect(frame)
                live_tracks = tracker.update(detections, now)

            # Gestures do **not** ride the motion gate: at 1080p one gate cell
            # covers 240x180 px and needs 40% of it to change by >25 gray levels,
            # so a hand at 1.5 m (~7% of a cell) can never trip it — and a hand held
            # still is absorbed into the background in ~2-4 s, i.e. exactly when the
            # model becomes confident. They do not ride a *schedule* either: the
            # recognizer is asked on every frame the loop reads, exactly like the
            # gate. Its `VIDEO` mode tracks the hand across calls, so a sparse
            # cadence does not delay the answer, it destroys it — fed one frame per
            # second it reported a hand and no gesture *every time* (measured live on
            # a held sign), while the same frames at the loop's own rate classified
            # it (`Victory 0.50-0.71`, 24 consecutive frames). Rationing it was
            # rationing the cheapest tier of the cascade anyway: 24.7 ms/frame
            # against the detector's 156 ms, i.e. ~12% of one core at 5/s. What keeps
            # a wave from flooding the bus is `GestureGate` (one event per name per
            # cooldown), not the sampling rate — asking is free of side effects.
            if gestures:
                try:
                    hits = gestures.detect(frame)
                except Exception as e:
                    # An optional tier must never kill the feed: say it once and
                    # stop asking (the thread would otherwise die and the camera
                    # would go silent).
                    print(f'[feed {camera_id}] gestures disabled: {e}')
                    gestures = None
                    hits = []
                for hit in gesture_vote.observe(hits):
                    if not gesture_gate.accept(hit, now):
                        continue
                    poster.submit(
                        {
                            'cameraId': camera_id,
                            'modes': gesture_modes,
                            'kind': 'gesture',
                            'classes': [hit.name],
                            'score': hit.score,
                            'at': int(time.time() * 1000),
                        }
                    )
            events = policy.update(now, policy_tracks(detected, live_tracks))
            for ev in events:
                if ev.kind == 'leave':
                    # Retire the id with the event: a reused id would make the next
                    # `enter` look like the same visit to a client keying on trackId.
                    tracker.forget(ev.track_id)
                payload = {
                    'cameraId': camera_id,
                    'modes': modes_by_class.get(ev.cls, []),
                    'kind': ev.kind,
                    'classes': [ev.cls],
                    'trackId': ev.track_id,
                    'at': int(time.time() * 1000),
                    'dwellMs': int((ev.dwell_s or 0) * 1000)
                    if ev.dwell_s
                    else None,
                }
                # Escalation is rare: only the kinds the policy asks for, and only
                # for the classes whose modes opted in. The brain picks the model
                # (fast first) and stores the keyframe. It runs in the poster's
                # worker, never here: a VLM call lasts seconds, and blocking the
                # loop on it made the camera deaf right after a gesture — exactly
                # when the next wave arrives.
                escalate = bool(
                    escalate_classes
                    and ev.cls in escalate_classes
                    and ev.kind in config.ESCALATE_KINDS
                )
                poster.submit(payload, frame if escalate else None)

            # One instrumentation path for the trace and the UI (`pipeline.observe`):
            # the same numbers whether they are printed or drawn, and no cost at all
            # when neither is on.
            frame_no += 1
            fps_frames += 1
            if now - fps_since >= 1.0:
                fps = fps_frames / (now - fps_since)
                fps_frames = 0
                fps_since = now
            if observer is not None or config.DEBUG:
                live_ids = {t.id for t in live_tracks}
                stats = observe.FrameStats(
                    at=now,
                    wall=time.time(),
                    frame_no=frame_no,
                    fps=fps,
                    motion=motion.motion,
                    gate_score=motion.score,
                    detected=detected,
                    detections=observe.detections_of(detections),
                    tracks=observe.tracks_of(live_tracks),
                    events=observe.events_of(events),
                    gesture=gestures.last if gestures else None,
                    pending=policy.pending(),
                    born=tuple(sorted(live_ids - known_ids)),
                    source_skipped=int(getattr(source, 'skipped', 0)),
                    source_backlog=_pending(source),
                )
                known_ids |= live_ids
                if observer is not None:
                    observer(frame, stats)
                if config.DEBUG and now - last_trace >= 1.0:
                    last_trace = now
                    print(observe.debug_line(stats))
            time.sleep(frame_sleep(time.monotonic() - now, config.IDLE_FPS))
    finally:
        poster.close()
        source.close()
        print(f'[feed {camera_id}] stopped')


def run_brain(observer=None, sink=None):
    """Poll the brain for feeds and run one cascade thread per camera.

    `observer`/`sink` are handed to every feed thread (`run_feed`) — `debug.py` uses
    them to draw the live view and to keep the events in memory instead of posting
    them; the poll loop, the stop/start decisions and the payloads are unchanged.
    """
    import threading

    threads = {}
    stops = {}
    print(f'[brain] polling {config.BRAIN_URL} every {config.FEED_POLL_S}s')
    try:
        while True:
            feeds = brain.fetch_feeds()
            # `None` = the brain did not answer, `[]` = it answered and no camera
            # selected a mode. Only the second one is a reason to stop anything.
            answered = feeds is not None
            wanted = {f['cameraId']: f for f in (feeds or []) if f.get('cameraId')}
            if not answered:
                print(f'[brain] feeds unavailable, keeping {len(threads)} feed(s)')

            # An answered poll is authoritative: a camera no longer selected is
            # stopped. A dead thread is stopped too — it is invisible otherwise, the
            # camera would stay selected while nothing runs, and recreating it also
            # retries a source that could not be opened. An *unanswered* poll stops
            # nothing at all (`loop.feeds_to_stop`): a brain restart must not blind
            # every camera, nor make each one re-pay its detector and recognizer load.
            dead = {cid for cid in threads if not threads[cid].is_alive()}
            to_stop = feeds_to_stop(list(threads), list(wanted), answered) | dead
            for cid in sorted(to_stop):
                stops[cid].set()
                threads[cid].join(timeout=5)
                threads.pop(cid, None)
                stops.pop(cid, None)

            for cid, feed in wanted.items():
                if cid in threads:
                    continue
                stop = threading.Event()
                thread = threading.Thread(
                    target=run_feed,
                    args=(feed, stop),
                    kwargs={'sink': sink, 'observer': observer},
                    daemon=True,
                )
                stops[cid] = stop
                threads[cid] = thread
                thread.start()

            time.sleep(config.FEED_POLL_S)
    except KeyboardInterrupt:
        for stop in stops.values():
            stop.set()


def main() -> None:
    p = argparse.ArgumentParser(description='vision-feed: run the cascade on a source')
    p.add_argument('--source', default='webcam', help='webcam[:index]')
    p.add_argument('--headless', action='store_true', help='no preview window')
    p.add_argument('--seconds', type=float, default=None, help='stop after N s')
    p.add_argument(
        '--gate-only', action='store_true', help='measure Tier 0 alone (no detector)'
    )
    p.add_argument(
        '--brain', action='store_true', help="poll the brain for feeds (the container's mode)"
    )
    args = p.parse_args()
    if args.brain:
        run_brain()
    else:
        run(args.source, args.headless, args.seconds, args.gate_only)


if __name__ == '__main__':
    main()
