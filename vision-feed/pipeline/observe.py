"""What the cascade saw, per frame — the trace's and the debug UI's only source.

`main.run_feed` calls an optional observer with the frame and a `FrameStats`. Two
consumers share that one call:

- the `VISION_DEBUG` trace prints `debug_line` about once a second, and
- `debug.py` (the local UI) draws the boxes on the live MJPEG and serves the same
  numbers as JSON.

One instrumentation path, so the log and the UI can never disagree about what
happened — which matters here, because the whole point of the harness is to look at a
symptom in the log and then *see* it.

Pure-ish: the stats, the ring and the counters are stdlib; `annotate` / `encode_jpeg`
import cv2 lazily, like the rest of `pipeline/`.
"""
from dataclasses import dataclass, field

#: Box colours by track id (BGR) — stable per id, so a box that keeps its id keeps
#: its colour, and a box that changes colour is a new id (what the UI looks for).
PALETTE = (
    (80, 220, 80),
    (80, 180, 255),
    (255, 160, 80),
    (220, 120, 220),
    (80, 230, 230),
    (200, 200, 120),
)
#: A carried (unconfirmed) track, and an id minted on this frame.
CARRIED_COLOR = (140, 140, 140)
NEW_COLOR = (255, 0, 255)


@dataclass
class FrameStats:
    """One loop iteration, as seen from outside the cascade."""

    at: float  # monotonic seconds
    wall: float  # epoch seconds (what the log shows)
    frame_no: int
    fps: float  # measured, over the last second
    motion: bool  # the gate's verdict
    gate_score: float
    detected: bool  # did the detector look on this frame?
    detections: list = field(default_factory=list)  # [(cls, conf, box)]
    tracks: list = field(default_factory=list)  # [(id, cls, matched, box)]
    events: list = field(default_factory=list)  # [(kind, track_id, cls)]
    gesture: dict | None = None  # {'hands', 'top', 'score'} — the raw answer
    pending: dict = field(default_factory=dict)  # {track_id: looks} — enter not yet
    born: tuple = ()  # ids minted on this frame (the churn the UI watches for)
    #: Frames the **source** passed over because a newer one had already arrived
    #: (`sources.MjpegSource.skipped`). A live feed is read newest-frame, so this is 0
    #: unless the reader was behind its own buffer — which is what "the picture is
    #: late" looks like as a number.
    source_skipped: int = 0
    #: Bytes the source's transport still held unread *after* the frame was taken
    #: (`sources.MjpegSource.pending()`, i.e. `SIOCINQ`): the floor of the delay the
    #: analysed picture carries. The reader drains its socket on every call, so this is
    #: what arrived since — near zero when the loop keeps up with the camera, and a
    #: climbing number when its tick is slower than the capture rate.
    source_backlog: int = 0

    @property
    def track_ids(self) -> set:
        return {t[0] for t in self.tracks}

    def to_dict(self) -> dict:
        """JSON-ready (the UI polls it; boxes are rounded to pixels)."""
        return {
            'at': round(self.at, 3),
            'wall': self.wall,
            'frame': self.frame_no,
            'fps': round(self.fps, 2),
            'motion': self.motion,
            'gateScore': round(self.gate_score, 3),
            'detected': self.detected,
            'detections': [
                {'cls': c, 'conf': round(f, 2), 'box': [int(v) for v in b]}
                for c, f, b in self.detections
            ],
            'tracks': [
                {'id': i, 'cls': c, 'matched': bool(m), 'box': [int(v) for v in b]}
                for i, c, m, b in self.tracks
            ],
            'events': [
                {'kind': k, 'trackId': i, 'cls': c} for k, i, c in self.events
            ],
            'gesture': self.gesture,
            'pending': self.pending,
            'born': [int(v) for v in self.born],
            'sourceSkipped': int(self.source_skipped),
            'sourceBacklog': int(self.source_backlog),
        }


def detections_of(detections) -> list:
    """`[(cls, conf, box)]` from the detector's `Detection` objects."""
    return [
        (str(d.cls), float(d.conf), tuple(float(v) for v in d.box))
        for d in detections or ()
    ]


def tracks_of(tracks) -> list:
    """`[(id, cls, matched, box)]` from the tracker's `Track` objects."""
    return [
        (int(t.id), str(t.cls), bool(getattr(t, 'matched', True)), tuple(t.box))
        for t in tracks or ()
    ]


def events_of(events) -> list:
    """`[(kind, track_id, cls)]` from the policy's `Event` objects."""
    return [(str(e.kind), int(e.track_id), str(e.cls)) for e in events or ()]


def _bytes(n: int) -> str:
    """Bytes as the trace writes them: `293k`, and the plain count when it is small."""
    return f'{n / 1024:.0f}k' if n >= 1024 else f'{n}B'


def debug_line(stats: FrameStats) -> str:
    """One line for the trace: everything that decided this frame, in order.

    `#7 person` is a confirmed track, `#7 person~` one carried across a miss (alive,
    not confirmed) and `#7 person*` one born on this frame — the three states whose
    confusion produced the enter/leave churn.
    """
    parts = [
        f'f={stats.frame_no} fps={stats.fps:.1f}',
        f'gate={"motion" if stats.motion else "quiet"}:{stats.gate_score:.2f}',
        f'det={"yes" if stats.detected else "no"}',
    ]
    if stats.source_skipped:
        # The reader was behind its own buffer: the frame analysed is the newest one,
        # and the ones it passed over are counted here (a live feed, never a queue).
        parts.append(f'src-skipped={stats.source_skipped}')
    if stats.source_backlog:
        # Bytes still unread in the socket *after* the read: the delay that remains once
        # the reader has drained everything it could. Near zero is healthy; a climbing
        # number means the loop's tick is slower than the camera.
        parts.append(f'src-backlog={_bytes(stats.source_backlog)}')
    if stats.tracks:
        labels = []
        for tid, cls, matched, _ in stats.tracks:
            mark = '*' if tid in stats.born else ('' if matched else '~')
            labels.append(f'#{tid} {cls}{mark}')
        parts.append('tracks ' + ', '.join(labels))
    elif stats.detected:
        parts.append('tracks none')
    if stats.pending:
        parts.append(
            'pending '
            + ', '.join(f'#{tid}:{looks}' for tid, looks in stats.pending.items())
        )
    if stats.gesture is not None:
        answer = stats.gesture
        # The two extra columns are what a sign that did not fire needs: the model says
        # "a hand, no category", the geometry says whether it named it anyway.
        extra = ''
        if 'landmarks' in answer:
            # The two tiers are named apart: a movement that was *spelled* but not
            # published (a vote that never forms, a cooldown) has to be readable from
            # the line alone.
            rules = ','.join(answer.get('rules') or ()) or '-'
            motion = ','.join(answer.get('motion') or ()) or '-'
            extra = (
                f' tracked={answer["landmarks"]} rules={rules} motion={motion}'
            )
        parts.append(
            f'gesture {answer.get("top") or "-"} '
            f'{answer.get("score", 0):.2f} hands={answer.get("hands", 0)}{extra}'
        )
    if stats.events:
        parts.append(
            'events ' + ', '.join(f'{kind}#{tid}' for kind, tid, _ in stats.events)
        )
    return '[debug] ' + ' | '.join(parts)


class Counters:
    """Running totals — the churn metrics the harness is actually testing.

    Two numbers, two jobs:

    - `enters` / `leaves` count the events the **policy** emitted, i.e. only the classes
      the camera's modes watch (`presence` → `person`). This is the churn metric: one
      person standing in front of the camera must read `enters 1`, where the live log
      showed 422 for a single person.
    - `tracks_minted` counts every **distinct id the tracker created, whatever the
      class**. A camera pointed at a room mints ids for the furniture the detector
      flickers on (`bed`, `book`, `remote` — measured), which emit no event at all, so
      this number is a tracker-health reading, not a visit count. `by_class` is what
      tells the two apart.
    """

    def __init__(self):
        self.frames = 0
        self.enters = 0
        self.leaves = 0
        self.dwells = 0
        self.gesture_frames = 0
        self.enters_by_class: dict[str, int] = {}
        self.leaves_by_class: dict[str, int] = {}
        self.dwells_by_class: dict[str, int] = {}
        self._first_seen: dict[int, float] = {}
        self._last_seen: dict[int, float] = {}
        self._class_of: dict[int, str] = {}

    def observe(self, stats: FrameStats) -> None:
        self.frames += 1
        for tid, cls, _, _ in stats.tracks:
            self._first_seen.setdefault(tid, stats.at)
            self._last_seen[tid] = stats.at
            self._class_of.setdefault(tid, cls)
        for kind, tid, cls in stats.events:
            if kind == 'enter':
                self.enters += 1
                self.enters_by_class[cls] = self.enters_by_class.get(cls, 0) + 1
            elif kind == 'leave':
                self.leaves += 1
                self.leaves_by_class[cls] = self.leaves_by_class.get(cls, 0) + 1
            elif kind == 'dwell':
                self.dwells += 1
                self.dwells_by_class[cls] = self.dwells_by_class.get(cls, 0) + 1
        if stats.gesture and stats.gesture.get('top'):
            self.gesture_frames += 1

    @property
    def tracks_minted(self) -> int:
        return len(self._first_seen)

    def minted_by_class(self) -> dict:
        """How many ids each class ever got (furniture included)."""
        out: dict[str, int] = {}
        for cls in self._class_of.values():
            out[cls] = out.get(cls, 0) + 1
        return out

    def summary(self) -> dict:
        """JSON-ready totals (the UI's counter panel)."""
        longest = max(
            (
                self._last_seen.get(tid, at) - at
                for tid, at in self._first_seen.items()
            ),
            default=0.0,
        )
        return {
            'frames': self.frames,
            'enters': self.enters,
            'leaves': self.leaves,
            'dwells': self.dwells,
            'tracksMinted': self.tracks_minted,
            'gestureFrames': self.gesture_frames,
            'longestTrackS': round(longest, 1),
            'entersByClass': dict(self.enters_by_class),
            'leavesByClass': dict(self.leaves_by_class),
            'dwellsByClass': dict(self.dwells_by_class),
            'mintedByClass': self.minted_by_class(),
        }


class Ring:
    """A bounded buffer of the last frames, newest last (the UI's timeline)."""

    def __init__(self, size: int = 300):
        self.size = max(1, int(size))
        self._items: list = []

    def append(self, item) -> None:
        self._items.append(item)
        if len(self._items) > self.size:
            del self._items[: len(self._items) - self.size]

    def recent(self, limit: int = None) -> list:
        """The last `limit` items, newest first."""
        items = self._items if limit is None else self._items[-int(limit) :]
        return list(reversed(items))

    def clear(self) -> None:
        self._items = []

    def __len__(self) -> int:
        return len(self._items)


def color_for(track_id: int):
    """A stable colour per track id (so a changed colour means a new id)."""
    return PALETTE[(int(track_id) - 1) % len(PALETTE)]


def annotate(frame, stats: FrameStats, copy: bool = True):
    """Draw the frame's verdict on it: boxes, ids, the gate, the gesture.

    The **raw** box is drawn, not a smoothed one: the jitter is the diagnosis. A box
    that changes colour is a new id, a grey one is a track nobody confirmed this frame
    (`matched=False`) and a magenta one was minted on this very frame — which is what
    makes "the id churned again" visible instead of a number in a log. A track still
    short of its `enter` shows `2/?`, i.e. how many looks it has.
    """
    import cv2

    img = frame.copy() if copy else frame
    for tid, cls, matched, box in stats.tracks:
        x1, y1, x2, y2 = (int(v) for v in box)
        if tid in stats.born:
            color, tag = NEW_COLOR, ' NEW'
        elif not matched:
            color, tag = CARRIED_COLOR, ' ~'
        else:
            color, tag = color_for(tid), ''
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
        label = f'#{tid} {cls}{tag}'
        if stats.pending.get(tid):
            label += f' {stats.pending[tid]}/?'
        cv2.putText(
            img, label, (x1, max(14, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2
        )

    header = (
        f'gate {"motion" if stats.motion else "quiet"} {stats.gate_score:.2f}  '
        f'det {"yes" if stats.detected else "no"}  {stats.fps:.1f} fps'
    )
    cv2.putText(img, header, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
    if stats.gesture is not None:
        answer = stats.gesture
        text = f'gesture {answer.get("top") or "-"} {answer.get("score", 0):.2f}'
        spelled = ','.join(
            list(answer.get('rules') or ()) + list(answer.get('motion') or ())
        )
        if spelled:
            text += f' [{spelled}]'
        cv2.putText(img, text, (10, 52), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)
    if stats.events:
        text = ' | '.join(f'{kind}#{tid}' for kind, tid, _ in stats.events)
        cv2.putText(
            img,
            text,
            (10, img.shape[0] - 14),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 0, 255),
            2,
        )
    return img


def display_copy(frame, width: int = 0):
    """The frame the UI's MJPEG shows: the picture downscaled for a page, not for a model.

    The debug page used to draw and encode every connected client's own full-resolution
    frame, on the very cores the cascade runs on — a tool that slows down the feed it is
    measuring, i.e. the lag it exists to expose. `width=0` (the default) keeps the frame
    as it is, so a caller decides the cost explicitly.
    """
    import cv2

    if not width or frame.shape[1] <= width:
        return frame
    scale = width / float(frame.shape[1])
    return cv2.resize(frame, (int(width), max(1, int(frame.shape[0] * scale))))


def encode_jpeg(frame, quality: int = 70) -> bytes | None:
    """Encode a BGR frame as JPEG bytes (None when cv2 refuses)."""
    import cv2

    ok, buf = cv2.imencode(
        '.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)]
    )
    return buf.tobytes() if ok else None


def mjpeg_part(jpeg: bytes, boundary: bytes = b'--frame') -> bytes:
    """One `multipart/x-mixed-replace` part (what an `<img>` consumes)."""
    head = boundary + b'\r\nContent-Type: image/jpeg\r\n'
    head += f'Content-Length: {len(jpeg)}\r\n\r\n'.encode()
    return head + jpeg + b'\r\n'
