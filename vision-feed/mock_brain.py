"""A stub brain for the debug UI: the feed list, and the events it receives.

`vision-feed` is a **sensor**: it polls `GET /api/vision/feeds` and posts to
`POST /api/vision/events`, and everything it knows about a camera comes from that
payload (the brain resolves the modes, `cameras/modes.ts`). A debug UI needs that
contract *exercised*, not bypassed — so this module answers the same routes with the
same shapes on its own port, and `debug.py` points `config.BRAIN_URL` at it. `brain.py`
is then the real client and `main.run_brain` the real poll loop; the only fakes are
Mongo, Home Assistant and the camera registry.

Deliberately not done here: no token validation (the Authorization header is *recorded*
instead, so the harness can prove the service token travels) and no policy of its own —
`MODES` mirrors the brain's table and `policy_of` applies the same rules as
`visionPolicyOf`.

Pure where it matters: `feed()` and `EventRing` are testable without a socket; the HTTP
surface is thin glue over them.
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# --- the mode table, mirrored from nodejs-apis/src/cameras/modes.ts ----------------
# The brain owns the real one; this is what the UI offers so a mode can be selected
# without a Mongo. Same ids, same classes, same dwells, same flags.
MODES = {
    'presence': {
        'label': 'Présence',
        'classes': ['person'],
        'dwellS': 15,
        'cooldownS': 60,
        'escalate': True,
    },
    'pet': {
        'label': 'Animal',
        'classes': ['cat', 'dog'],
        'dwellS': 10,
        'cooldownS': 120,
    },
    'entrance': {
        'label': 'Entrée / intrusion',
        'classes': ['person'],
        'dwellS': 3,
        'cooldownS': 60,
        'escalate': True,
    },
    'grocery': {
        'label': 'Courses (frigo, placard)',
        'classes': ['person'],
        'dwellS': 20,
        'cooldownS': 300,
        'escalate': True,
        'grocery': True,
    },
    'commands': {
        'label': 'Commandes gestuelles',
        'classes': ['person'],
        'dwellS': 60,
        'cooldownS': 60,
        'gestures': True,
    },
}

MODE_IDS = tuple(MODES)


def mode_options() -> list:
    """`[{value, label, classes}]` — what the UI's mode picker renders."""
    return [
        {
            'value': mid,
            'label': mode['label'],
            'classes': list(mode['classes']),
            'gestures': bool(mode.get('gestures')),
        }
        for mid, mode in MODES.items()
    ]


def policy_of(mode_ids) -> dict:
    """The per-class policy `visionPolicyOf` would resolve (same rules, same order).

    The union of the classes in table order, the **shortest** dwell per class, and
    escalation only for the classes of the escalating modes — a `pet` camera must not
    pay a VLM call because `presence` escalates.
    """
    classes: list = []
    dwell_by_class: dict = {}
    escalate: list = []
    modes_by_class: dict = {}

    for mid in mode_ids:
        mode = MODES.get(mid)
        if not mode:
            continue
        for cls in mode['classes']:
            if cls not in classes:
                classes.append(cls)
            named = modes_by_class.setdefault(cls, [])
            if mid not in named:
                named.append(mid)
            if mode.get('escalate') and cls not in escalate:
                escalate.append(cls)
            dwell = mode.get('dwellS')
            if isinstance(dwell, (int, float)) and dwell > 0:
                current = dwell_by_class.get(cls)
                if current is None or dwell < current:
                    dwell_by_class[cls] = dwell

    return {
        'classes': classes,
        'dwellByClass': dwell_by_class,
        'escalateClasses': escalate,
        'gestureModes': [
            mid for mid in mode_ids if MODES.get(mid, {}).get('gestures')
        ],
        'modesByClass': modes_by_class,
    }


def feed(camera_id: str, source: dict, mode_ids, name: str = 'Debug camera') -> dict:
    """One `GET /api/vision/feeds` entry, in the brain's own shape.

    `relay: False` is what a debug UI wants: the container opens the camera itself
    (`sources.feed_source` returns the descriptor unchanged), so there is no brain in
    the frame path, no token and no passthrough to debug on top of the cascade.
    """
    return {
        'cameraId': camera_id,
        'name': name,
        'modes': list(mode_ids),
        'relay': False,
        'source': dict(source or {}),
        'policy': policy_of(mode_ids),
    }


def feeds_document(one_feed) -> dict:
    """The body of `GET /api/vision/feeds` (`[]` = no camera selected a mode)."""
    return {'feeds': [one_feed] if one_feed else []}


class EventRing:
    """What the mock brain received, plus the counts the harness asserts on.

    `enters` / `leaves` / `dwells` / `gestures` here are what the *events* said — the
    durable half of the diagnosis. The live `tracks minted` counter (`observe.Counters`)
    is the other half: churn shows up there first.
    """

    def __init__(self, size: int = 500):
        self.size = max(1, int(size))
        self.counts: dict = {}
        self.auth: str | None = None
        self.requests = 0
        self.describes = 0
        self._events: list = []
        self._lock = threading.Lock()

    def append(self, event) -> None:
        with self._lock:
            self._events.append(dict(event))
            if len(self._events) > self.size:
                del self._events[: len(self._events) - self.size]
            kind = str((event or {}).get('kind', '?'))
            self.counts[kind] = self.counts.get(kind, 0) + 1

    def recent(self, limit: int = 200) -> list:
        """The last `limit` events, newest first (what the timeline shows)."""
        with self._lock:
            items = self._events[-int(limit) :]
        return list(reversed(items))

    def clear(self) -> None:
        with self._lock:
            self._events = []
            self.counts = {}
            self.describes = 0

    def summary(self) -> dict:
        with self._lock:
            counts = dict(self.counts)
        return {
            'total': sum(counts.values()),
            'enters': counts.get('enter', 0),
            'leaves': counts.get('leave', 0),
            'dwells': counts.get('dwell', 0),
            'gestures': counts.get('gesture', 0),
            'byKind': counts,
            'describes': self.describes,
            'requests': self.requests,
        }


class _Handler(BaseHTTPRequestHandler):
    """The two routes `brain.py` uses, plus what the UI polls from them."""

    server_version = 'charlie-mock-brain/1.0'

    def log_message(self, *args):  # noqa: D102 - silence the default stderr spam
        pass

    # --- helpers ---
    def _body(self) -> dict:
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length).decode() if length else '{}'
        try:
            return json.loads(raw or '{}')
        except ValueError:
            return {}

    def _json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _note_request(self) -> None:
        state = self.server.state
        state.ring.requests += 1
        # Recorded, never validated: the point is to *see* the service token arrive
        # (`brain._headers`), not to gate on it.
        state.ring.auth = self.headers.get('Authorization')

    def _path(self) -> str:
        return self.path.split('?', 1)[0]

    # --- routes ---
    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler's naming
        self._note_request()
        state = self.server.state
        if self._path() == '/api/vision/feeds':
            self._json(feeds_document(state.feed()))
            return
        if self._path() == '/api/vision/events':
            self._json(
                {'events': state.ring.recent(200), 'counts': state.ring.summary()}
            )
            return
        self.send_error(404, 'not part of the mock brain')

    def do_POST(self):  # noqa: N802
        self._note_request()
        state = self.server.state
        path = self._path()
        if path == '/api/vision/events':
            state.ring.append(self._body())
            self._json({'ok': True})
            return
        if path == '/api/vision/describe':
            # Escalation, mocked: the poster must not see an error (`brain.describe`
            # swallows them, but the trace would show a failed VLM on every event).
            state.ring.describes += 1
            self._json(
                {
                    'ok': True,
                    'tier': 'mock',
                    'text': '(mock brain) une description factice de la scène',
                }
            )
            return
        if path == '/api/vision/reset':
            state.ring.clear()
            self._json({'ok': True})
            return
        self.send_error(404, 'not part of the mock brain')


def make_server(state, port: int, host: str = '127.0.0.1') -> ThreadingHTTPServer:
    """A `ThreadingHTTPServer` bound to `port`, with `state` on `server.state`.

    `state` only has to answer `feed()` (the current feed dict, or None) and expose
    `ring` — `debug.DebugState` is the one that does.
    """
    server = ThreadingHTTPServer((host, port), _Handler)
    server.daemon_threads = True
    server.state = state
    return server


def serve(state, port: int, host: str = '127.0.0.1'):
    """Start the mock brain in a daemon thread; returns the server."""
    server = make_server(state, port, host)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server
