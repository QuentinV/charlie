"""The local debug UI: the live cascade with its boxes, against a mocked brain.

    python debug.py                                  # the webcam helper (9312)
    python debug.py --source-kind webcam --source-url 0
    python debug.py --mode commands --mode presence --fps 5
    python debug.py --brain-url http://localhost:9300   # watch production instead

Open http://127.0.0.1:9313 for: the annotated MJPEG (boxes, track ids, the gate, the
recognizer's raw answer), the counters that matter (`enters`, `leaves`, `dwells`,
**tracks minted**), the event timeline and the per-frame trace — with a mocked brain on
9314 so the whole pipeline runs without `nodejs-apis`.

**What is real:** `main.run_brain`'s poll loop, `brain.py`'s client, the cascade
(gate → detector → tracker → policy → gestures) and the event payloads. **What is
mocked:** the brain — the feed list it serves and the sink the events land in. Mongo,
Home Assistant and the camera registry are not involved.

The MJPEG is annotated from the same `pipeline.observe` stats the `VISION_DEBUG` trace
prints, so the picture and the log cannot disagree; and the knobs below are written to
`config` and applied by **restarting the feed** (the real stop/start path), which is why
applying one resets the counters.
"""
import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import config
import mock_brain
from main import run_brain
from pipeline import observe

#: The knobs the UI may change: `name → (config attribute, cast)`. Everything here is
#: read by the feed when it *starts* (`main._cascade`, `IouTracker`, `GestureDetector`,
#: `GestureVote`), so applying one restarts the feed — the honest way to test a
#: threshold, and it exercises the same stop/start a brain poll uses.
KNOBS = {
    'fps': ('IDLE_FPS', float),
    'detectFps': ('DETECT_FPS', float),
    'detectConf': ('DETECT_CONF', float),
    'quietDetectFps': ('QUIET_DETECT_FPS', float),
    'missTtlS': ('MISS_TTL_S', float),
    'graceS': ('TRACK_GRACE_S', float),
    'dwellS': ('DWELL_S', float),
    'confirmLooks': ('ENTER_CONFIRM_LOOKS', int),
    'gestureMinScore': ('GESTURE_MIN_SCORE', float),
    'gestureCooldownS': ('GESTURE_COOLDOWN_S', float),
    'gestureRules': ('GESTURE_RULES', int),
    'gestureMotion': ('GESTURE_MOTION', int),
    'motionWindowS': ('GESTURE_MOTION_WINDOW_S', float),
    'motionTravel': ('GESTURE_MOTION_MIN_TRAVEL', float),
    'motionSamples': ('GESTURE_MOTION_MIN_SAMPLES', int),
    'motionWave': ('GESTURE_MOTION_WAVE_AMPLITUDE', float),
    'voteWindow': ('GESTURE_VOTE_WINDOW', int),
    'voteNeed': ('GESTURE_VOTE_NEED', int),
    'debug': ('DEBUG', int),
}
#: The source kinds `sources.source_for` understands, in the UI's order.
SOURCE_KINDS = ('mjpeg', 'webcam', 'rtsp', 'ha')


def set_knobs(values: dict) -> dict:
    """Write the known knobs to `config`; returns what was actually set."""
    applied = {}
    for name, raw in (values or {}).items():
        entry = KNOBS.get(name)
        if not entry or raw is None or raw == '':
            continue
        attr, cast = entry
        try:
            value = cast(raw)
        except (TypeError, ValueError):
            continue
        setattr(config, attr, value)
        applied[name] = value
    return applied


def read_knobs() -> dict:
    """The current value of every knob (what the UI's form shows)."""
    return {name: getattr(config, attr) for name, (attr, _) in KNOBS.items()}


class DebugState:
    """What the UI shows and what the mocked brain serves — one shared object.

    The feed thread writes (`on_frame`), the HTTP handlers read: the frame is a fresh
    array per iteration (the loop never draws on it in place), so a reference is safe.
    """

    def __init__(
        self,
        source: dict,
        mode_ids,
        name='Debug camera',
        forward=False,
        no_gestures=False,
    ):
        self.source = dict(source)
        self.mode_ids = list(mode_ids)
        self.name = name
        #: True when `--brain-url` points at a real brain: events are then also posted
        #: there (`brain.post_event`), instead of only being kept in the ring.
        self.forward = forward
        #: `--no-gestures`: the recognizer is never loaded (a host without mediapipe),
        #: by emptying the policy's `gestureModes` — the flag the feed actually reads.
        self.no_gestures = no_gestures
        self.ring = mock_brain.EventRing()
        self.counters = observe.Counters()
        self.frames = observe.Ring(240)
        self.health: dict = {}
        self.notes: list = []
        self.record_dir = None
        self.record_interval = 0.5
        self.latest = None  # (frame, stats)
        self.seq = 0
        self.camera_seq = 1
        self.started = time.time()
        self._recorded_at = 0.0
        self._lock = threading.Lock()

    # --- the mocked brain's contract (`mock_brain._Handler`) ---
    @property
    def camera_id(self) -> str:
        """The id the mocked brain serves.

        Applying a change bumps it, which is how `run_brain` is told to restart the
        feed (a camera that disappeared is stopped, the new one is started) — the real
        path, no harness-only code.
        """
        return f'debug-{self.camera_seq}'

    def feed(self):
        """The feed the mocked brain serves, or None when no mode is selected.

        An empty selection really is "not analysed" (`cameras/modes.ts` has no `off`
        row), so the feed disappears and `run_brain` stops the thread — the UI says so
        rather than showing a frozen picture that looks like a bug.
        """
        if not self.mode_ids:
            return None
        feed = mock_brain.feed(self.camera_id, self.source, self.mode_ids, self.name)
        if self.no_gestures:
            feed['policy']['gestureModes'] = []
        return feed

    def post_event(self, event):
        """The event sink: always kept for the timeline, forwarded when asked."""
        self.ring.append(event)
        if self.forward:
            import brain

            brain.post_event(event)

    # --- the feed's observer (`main.run_feed(observer=...)`) ---
    def on_frame(self, frame, stats) -> None:
        self.counters.observe(stats)
        self.frames.append(stats)
        with self._lock:
            self.latest = (frame, stats)
            self.seq += 1
        if self.record_dir and stats.at - self._recorded_at >= self.record_interval:
            self._recorded_at = stats.at
            self.record(frame, stats)

    def snapshot(self):
        """`(frame, stats, seq)` — the seq is what tells a stream handler it is new."""
        with self._lock:
            if self.latest is None:
                return None, None, self.seq
            frame, stats = self.latest
            return frame, stats, self.seq

    def record(self, frame, stats) -> None:
        """Write an annotated frame to `--record` (offline iteration on a symptom)."""
        try:
            os.makedirs(self.record_dir, exist_ok=True)
            jpeg = observe.encode_jpeg(observe.annotate(frame, stats), 80)
            if jpeg:
                path = os.path.join(
                    self.record_dir, f'frame_{int(stats.at * 10):010d}.jpg'
                )
                with open(path, 'wb') as handle:
                    handle.write(jpeg)
        except Exception as e:  # noqa: BLE001 - a debug aid never breaks the feed
            self.notes.append(f'record failed: {e}')
            self.record_dir = None

    # --- the UI's actions ---
    def apply(self, body: dict) -> dict:
        """Change the source/modes/knobs and restart the feed (counters reset)."""
        kind = str(body.get('sourceKind') or self.source.get('kind') or 'mjpeg')
        if kind in SOURCE_KINDS:
            self.source = {'kind': kind, 'url': str(body.get('sourceUrl') or '')}
        modes = body.get('modes')
        if modes is None:
            modes = self.mode_ids
        if isinstance(modes, str):
            modes = [m for m in modes.split(',') if m]
        self.mode_ids = [str(m) for m in modes if m in mock_brain.MODES]
        applied = set_knobs(body.get('knobs') or {})
        self.camera_seq += 1
        self.reset()
        return {
            'ok': True,
            'applied': applied,
            'source': dict(self.source),
            'modes': list(self.mode_ids),
            'cameraId': self.camera_id,
        }

    def reset(self) -> None:
        """Clear the counters, the timeline and the frame ring (not the config)."""
        self.counters = observe.Counters()
        self.frames.clear()
        self.ring.clear()
        with self._lock:
            self.latest = None
            self.seq += 1

    def config_view(self) -> dict:
        """Everything the page needs to describe the run in force."""
        feed = self.feed() or {}
        return {
            'source': dict(self.source),
            'modes': list(self.mode_ids),
            'modeOptions': mock_brain.mode_options(),
            'sourceKinds': list(SOURCE_KINDS),
            'policy': feed.get('policy') or {},
            'cameraId': self.camera_id,
            'knobs': read_knobs(),
            'health': self.health,
            'notes': list(self.notes),
            'uptimeS': round(time.time() - self.started, 1),
        }


class _UiHandler(BaseHTTPRequestHandler):
    """The page, the annotated stream, and the JSON the page polls."""

    server_version = 'charlie-vision-debug/1.0'

    def log_message(self, *args):  # noqa: D102 - no per-request stderr spam
        pass

    @property
    def state(self) -> DebugState:
        return self.server.state

    def _path(self) -> str:
        return self.path.split('?', 1)[0]

    def _json(self, payload, status: int = 200) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length).decode() if length else '{}'
        try:
            return json.loads(raw or '{}')
        except ValueError:
            return {}

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler's naming
        path = self._path()
        if path in ('/', '/index.html'):
            return self._page()
        if path == '/stream.mjpg':
            return self._stream()
        if path == '/api/stats':
            return self._json(self._stats())
        if path == '/api/events':
            return self._json(
                {
                    'events': self.state.ring.recent(200),
                    'counts': self.state.ring.summary(),
                }
            )
        if path == '/api/config':
            return self._json(self.state.config_view())
        self.send_error(404, 'not part of the debug UI')

    def do_POST(self):  # noqa: N802
        path = self._path()
        body = self._body()
        if path == '/api/apply':
            return self._json(self.state.apply(body))
        if path == '/api/reset':
            self.state.reset()
            return self._json({'ok': True})
        if path == '/api/knobs':
            applied = set_knobs(body)
            return self._json(
                {'ok': True, 'applied': applied, 'knobs': read_knobs()}
            )
        self.send_error(404, 'not part of the debug UI')

    def _stats(self) -> dict:
        state = self.state
        _, stats, seq = state.snapshot()
        return {
            'counters': state.counters.summary(),
            'events': state.ring.summary(),
            'latest': stats.to_dict() if stats else None,
            'seq': seq,
            'frames': [s.to_dict() for s in state.frames.recent(40)],
        }

    def _page(self) -> None:
        path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), 'static', 'debug.html'
        )
        try:
            with open(path, 'rb') as handle:
                body = handle.read()
        except OSError as e:
            self.send_error(500, f'static/debug.html unreadable: {e}')
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _stream(self) -> None:
        """The annotated MJPEG: one draw + one encode per frame, shared by every client.

        Nothing is encoded when nobody is watching, the drawing comes from the same
        `pipeline.observe` stats the trace prints, and the frame served is the *newest*
        one (`last_seq`) — a client that cannot keep up skips frames here rather than
        accumulating them in this socket, which is the same rule as everywhere else in
        this pipeline.
        """
        state = self.state
        self.send_response(200)
        self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        last_seq = -1
        idle = 0.0
        while True:
            frame, stats, seq = state.snapshot()
            if frame is None or seq == last_seq:
                time.sleep(0.02)
                idle += 0.02
                if idle >= 120:  # a client that vanished without closing the socket
                    return
                continue
            idle = 0.0
            last_seq = seq
            jpeg = self.server.render.jpeg(frame, stats, seq)
            if not jpeg:
                continue
            try:
                self.wfile.write(observe.mjpeg_part(jpeg))
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                return


class RenderedFrame:
    """The page's annotated JPEG: one draw + one encode per sequence number, shared.

    Every connected browser used to draw and encode its **own** full-resolution frame,
    on the same cores the cascade runs on — a tool that slows the feed it is measuring,
    which is exactly the lag it exists to expose. `width` downscales the display copy
    (a page does not need 1080p); 0 keeps the frame as it is.
    """

    def __init__(self, width: int = 960):
        self.width = int(width)
        self._lock = threading.Lock()
        self._seq = -1
        self._jpeg = b''

    def jpeg(self, frame, stats, seq: int) -> bytes:
        """The JPEG for `seq` — encoded once, however many clients are watching."""
        with self._lock:
            if seq != self._seq:
                draw = observe.annotate(observe.display_copy(frame, self.width), stats)
                self._jpeg = observe.encode_jpeg(draw, 70) or b''
                self._seq = seq
            return self._jpeg


def build_server(state: DebugState, port: int, host: str = '127.0.0.1', width: int = 960):
    """The UI server, with `state` on `server.state` (the handlers read it)."""
    server = ThreadingHTTPServer((host, port), _UiHandler)
    server.daemon_threads = True
    server.state = state
    server.render = RenderedFrame(width)
    return server


def probe_health() -> dict:
    """What the page must be able to say about the run: which models were found.

    The gesture probe is the interesting one: it creates the recognizer once and names
    the cause when it cannot (`gesture.GestureDetector.unavailable_reason`), which is
    how "gestures do nothing" becomes a line on the page instead of a mystery.
    """
    from pipeline.gesture import GestureDetector

    yolo = config.resolve_yolo_model()
    gesture_model = config.resolve_gesture_model()
    detector = GestureDetector()
    reason = detector.unavailable_reason()
    return {
        'yoloModel': yolo,
        'yoloFound': os.path.exists(yolo),
        'gestureModel': gesture_model,
        'gestureModelFound': os.path.exists(gesture_model),
        'gestures': reason or 'ok',
        # A trained classifier is optional; when it is loaded or ignored for a reason
        # (`detector.note`), the page says so instead of leaving it a mystery.
        'gestureClassifier': detector.classifier_path or '—',
        'gestureClassifierFound': bool(
            detector.classifier_path and os.path.exists(detector.classifier_path)
        ),
        # Found is not used: a lone `.tflite` cannot be merged in on the mediapipe we
        # ship, so it is refused with a `note` — and calling that "ok" is exactly the
        # readout that hides a real problem. True only when it was handed to the
        # recognizer.
        'gestureClassifierUsed': bool(
            detector.available() and detector.classifier_path and not detector.note
        ),
        'gestureNote': detector.note or '',
        'gestureRules': bool(config.GESTURE_RULES),
        'gestureMotion': bool(config.GESTURE_MOTION),
        'brainUrl': config.BRAIN_URL,
    }


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description='vision-feed debug UI: live boxes + a mocked brain'
    )
    parser.add_argument(
        '--source-kind',
        default='mjpeg',
        choices=SOURCE_KINDS,
        help='how frames are read (default: the webcam helper on 9312)',
    )
    parser.add_argument(
        '--source-url',
        default='http://127.0.0.1:9312/video.mjpg',
        help='stream URL, or the device index for --source-kind webcam',
    )
    parser.add_argument(
        '--mode',
        action='append',
        default=None,
        help='a mode id from the brain table (repeatable; default: presence)',
    )
    parser.add_argument('--port', type=int, default=9313, help='UI port')
    parser.add_argument(
        '--brain-port', type=int, default=9314, help='mocked brain port'
    )
    parser.add_argument(
        '--brain-url',
        default=None,
        help='watch a real brain instead of the mock (events are posted there too)',
    )
    parser.add_argument(
        '--host', default='127.0.0.1', help='bind address (0.0.0.0 to reach it)'
    )
    parser.add_argument(
        '--width',
        type=int,
        default=960,
        help='display width of the annotated MJPEG (0 = full resolution)',
    )
    parser.add_argument('--fps', type=float, default=None, help='loop rate')
    parser.add_argument(
        '--record', default=None, help='write annotated frames (2/s) to this directory'
    )
    parser.add_argument(
        '--debug', action='store_true', help='also print the VISION_DEBUG trace'
    )
    parser.add_argument(
        '--no-gestures',
        action='store_true',
        help='never load the recognizer (a host without mediapipe)',
    )
    return parser.parse_args(argv)


def main(argv=None) -> None:
    args = parse_args(argv)
    modes = [m for m in (args.mode or ['presence'])]
    source = {'kind': args.source_kind, 'url': args.source_url}
    state = DebugState(
        source,
        modes,
        forward=bool(args.brain_url),
        no_gestures=args.no_gestures,
    )
    state.record_dir = args.record

    knobs = {}
    if args.fps:
        knobs['fps'] = args.fps
    if args.debug:
        knobs['debug'] = 1
    set_knobs(knobs)

    # The service polls its brain every 5 s in production; the UI wants a mode change
    # to take effect while the person is still looking at the page.
    config.FEED_POLL_S = 1.0
    config.BRAIN_URL = args.brain_url or f'http://127.0.0.1:{args.brain_port}'
    if args.brain_url:
        print(f'[debug] real brain: {args.brain_url} (events are posted there)')
    else:
        mock_brain.serve(state, args.brain_port)
        print(f'[debug] mocked brain: http://127.0.0.1:{args.brain_port}/api/vision/*')

    state.health = probe_health()
    print(
        f'[debug] source {source["kind"]} '
        f'{source["url"] or "(device index 0)"} | modes {"+".join(modes) or "(none)"}'
    )
    print(f'[debug] gestures: {state.health["gestures"]}')
    print(f'[debug] UI: http://127.0.0.1:{args.port}')

    threading.Thread(
        target=run_brain,
        kwargs={'observer': state.on_frame, 'sink': state.post_event},
        daemon=True,
    ).start()

    server = build_server(state, args.port, args.host, args.width)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('[debug] stopped')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
