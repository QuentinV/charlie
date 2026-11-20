"""Camera frame sources.

`webcam` is the laptop PoC; `rtsp` / `mjpeg` / `ha` are what the brain hands a
feed. `cv2` is imported lazily.

The brain may also ask for a feed to be **relayed** (`feed_source`): the camera
then sits on the host where this service cannot reach it, so it is read from the
brain's own passthrough instead of from the camera.
"""
import select
from urllib.parse import quote


class FrameSource:
    def open(self):
        raise NotImplementedError

    def read(self):
        """Return a BGR frame (ndarray) or None when the stream ended."""
        raise NotImplementedError

    def pending(self) -> int:
        """Bytes this source's transport still holds unread — the lag, in bytes.

        A live reader leaves nothing behind on purpose (`MjpegSource.read` drains its
        socket), so whatever is still unread arrived *after* the frame last returned:
        it is the floor of the delay the analysed picture carries, and a rise means the
        loop's tick is slower than the camera. Only the marker reader can measure it;
        every other source reports 0 rather than guessing.
        """
        return 0

    def close(self) -> None:
        pass


class WebcamSource(FrameSource):
    def __init__(self, index: int = 0):
        self.index = index
        self._cap = None

    def open(self):
        import cv2

        # Prefer DirectShow on Windows (reliable for a local webcam); fall back to
        # the platform default elsewhere.
        cap = None
        for backend in (cv2.CAP_DSHOW, cv2.CAP_ANY):
            try:
                candidate = cv2.VideoCapture(self.index, backend)
            except Exception:
                continue
            if candidate.isOpened():
                cap = candidate
                break
            candidate.release()
        if cap is None:
            raise RuntimeError(f'could not open webcam index {self.index}')
        self._cap = cap
        return self

    def read(self):
        ok, frame = self._cap.read()
        return frame if ok else None

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None


def open_source(spec: str) -> FrameSource:
    """Open a source from a laptop spec: `webcam[:index]`.

    Every other kind (rtsp / mjpeg / ha / echo) is built by `source_for()` from the
    provider row's settings — which is what the brain's feeds carry, and why the
    laptop harness only has the one form.
    """
    if spec == 'webcam' or spec.startswith('webcam:'):
        idx = int(spec.split(':', 1)[1]) if ':' in spec else 0
        return WebcamSource(idx).open()
    raise NotImplementedError(f'source {spec!r}: use source_for() with a kind/url spec')


class UrlSource(FrameSource):
    """A streaming source (rtsp / mjpeg) opened by OpenCV."""

    def __init__(self, url: str, headers: dict | None = None):
        self.url = url
        self.headers = headers or {}
        self._cap = None

    def open(self):
        import cv2

        cap = cv2.VideoCapture(self.url)
        if not cap.isOpened():
            raise RuntimeError(f'could not open stream {self.url!r}')
        # The same rule as the marker reader, asked of the backend instead: a live
        # capture that is not read in step queues frames inside OpenCV, and a queued
        # frame is a late picture. Best-effort — an MJPEG stream is read by
        # `MjpegSource` precisely because the queue could not be bounded here.
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:  # noqa: BLE001
            pass
        self._cap = cap
        return self

    def read(self):
        ok, frame = self._cap.read()
        return frame if ok else None

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None


class SnapshotSource(FrameSource):
    """A single-image endpoint (HA `camera_proxy`): one JPEG per `read()`."""

    def __init__(self, url: str, token: str = ''):
        self.url = url
        self.token = token

    def open(self):
        return self

    def read(self):
        import urllib.request

        import cv2
        import numpy as np

        headers = {}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        try:
            req = urllib.request.Request(self.url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as res:
                buf = np.frombuffer(res.read(), np.uint8)
            return cv2.imdecode(buf, cv2.IMREAD_COLOR)
        except Exception as e:  # noqa: BLE001
            print(f'[source] snapshot failed: {e}')
            return None

    def close(self) -> None:
        pass


class MjpegSource(FrameSource):
    """An MJPEG (multipart) stream, read JPEG by JPEG.

    `cv2.VideoCapture(url)` demuxes this with ffmpeg, and that demuxer desyncs on a
    consumer that pauses — which this service does routinely (it loads ONNX and
    MediaPipe models, and a VLM call runs on the same box). It then prints
    `[mpjpeg @ ...] Expected boundary '--' not found` and `read()` returns None
    *forever*: a camera that is deaf, with no error anywhere. Reproduced against the
    brain's relayed stream.

    Reading the JPEG markers ourselves cannot desync — a frame is the bytes between
    `0xFF 0xD8` and `0xFF 0xD9`, whatever the multipart framing does — and a stalled
    socket ends in `None`, which the loop answers by reopening the feed
    (`main.run_feed`).

    `read()` returns the **newest** complete frame the *transport* holds, not the oldest
    (`skipped` counts the ones it passed over), and it **drains the socket** on every
    call rather than pulling one `chunk` of it. Reading a single chunk was a hard ceiling
    on intake — `chunk × loop fps`, i.e. 320 KB/s at the loop's 5 fps against a 64 KB
    chunk — while a camera publishing more than that (a 1080p MJPEG is megabytes per
    second) left everything else waiting in the kernel's receive buffer, which Linux
    autotunes to megabytes: a picture seconds old, invisible to the publisher (it is Node
    user-space) and to `skipped` (those frames were never read). Draining bounds the lag
    at one tick instead of at a socket buffer, and `pending()` reports what little
    remains. It is the consumer half of the same rule the publisher enforces
    (`nodejs-apis/src/cameras/webcam.ts#pickRecipients`): a live frame is dropped, never
    queued — on this hop too, where "the queue" is the kernel's.

    The injected `opener` is what makes this testable without a camera: it is called
    with `(url, headers)` and must return a file-like object.
    """

    SOI = b'\xff\xd8'
    EOI = b'\xff\xd9'

    def __init__(
        self,
        url: str,
        headers: dict | None = None,
        opener=None,
        chunk: int = 65536,
        max_pulls: int = 32,
    ):
        self.url = url
        self.headers = headers or {}
        self.chunk = chunk
        #: Most reads one `read()` may spend draining the socket (`chunk × max_pulls`,
        #: 2 MB by default) — a bound on the work, never on the freshness.
        self.max_pulls = max_pulls
        self._opener = opener
        self._res = None
        self._buffer = b''
        #: Every complete frame this reader decoded and passed over because a newer one
        #: had already arrived (within one read, or across the reads of a drain).
        self.skipped = 0

    def open(self):
        self._res = self._connect()
        self._buffer = b''
        return self

    def _connect(self):
        if self._opener is not None:
            return self._opener(self.url, self.headers)
        import urllib.request

        req = urllib.request.Request(self.url, headers=self.headers)
        # A timeout is what turns a stalled stream into `None` (and a reopen)
        # instead of a feed thread parked in a read forever.
        return urllib.request.urlopen(req, timeout=10)

    def read(self):
        """The newest complete JPEG, or None when the stream ended or stalled."""
        if self._res is None:
            return None
        try:
            newest = self._drain()
            if newest is not None:
                return newest
            # Nothing was waiting: block for the next data (which is what paces a live
            # feed, instead of waiting for a read size to fill).
            while True:
                frame = self._extract()
                if frame is not None:
                    return frame
                chunk = self._pull()
                if not chunk:
                    return None
                self._buffer += chunk
        except Exception as e:  # noqa: BLE001
            print(f'[source] mjpeg read failed: {e}')
            return None

    def _drain(self):
        """Take everything the transport already holds, keeping the newest frame.

        A ticked reader must empty its transport, not sip one chunk of it: whatever it
        leaves behind sits in the kernel's receive buffer and comes back as a picture
        that is seconds old — the queue this reader exists to refuse, one hop further
        down. Draining is what bounds the lag at *one tick* instead of at a socket
        buffer size, and it is why `pending()` stays a reading rather than a backlog.
        `max_pulls` keeps a pathological burst from owning the loop.
        """
        newest = None
        pulls = 0
        more = False
        while pulls < self.max_pulls and (more or self._readable()):
            chunk = self._pull()
            if not chunk:
                break
            pulls += 1
            self._buffer += chunk
            frame = self._extract()
            if frame is not None:
                if newest is not None:
                    # A frame from an earlier read was decoded and passed over as well:
                    # `_extract` only counts the ones superseded inside *its* buffer, so
                    # without this the backlog reading would depend on the read size.
                    self.skipped += 1
                newest = frame
            # A full pull means the transport had at least `chunk` to give: more may be
            # sitting in the reader's own buffer, where `select` cannot see it.
            more = len(chunk) >= self.chunk
        return newest

    def _pull(self) -> bytes:
        """Whatever the transport has right now, at most `chunk`."""
        read1 = getattr(getattr(self._res, 'fp', None), 'read1', None)
        if read1 is not None:
            # `read(n)` on a buffered HTTP response waits until `n` bytes are there (or
            # EOF), i.e. it is paced by the read size — about three frames at 64 KB.
            # `read1` returns as soon as anything is available.
            return read1(self.chunk)
        return self._res.read(self.chunk)

    def _sock(self):
        """The transport's socket, when the response exposes one (urllib's does)."""
        fp = getattr(self._res, 'fp', None)
        sock = getattr(getattr(fp, 'raw', None), '_sock', None)
        if sock is not None:
            return sock
        # A test double may hand its socket over directly.
        return getattr(self._res, 'sock', None)

    def _readable(self) -> bool:
        """Is there anything to read *now*? (`False` when the transport cannot say.)

        A transport without a socket — a file-like stand-in — reports False, and
        `read()` then behaves as it did before: one pull at a time.
        """
        sock = self._sock()
        if sock is None:
            return False
        try:
            return bool(select.select([sock], [], [], 0)[0])
        except (OSError, ValueError):
            return False

    def pending(self) -> int:
        """Bytes still unread in the socket — the residual lag, in bytes.

        `SIOCINQ` is the only honest look at the queue we do not own: after `read()`
        drained everything, what is left arrived *after* the frame just returned, so a
        number that climbs means the loop's tick is slower than the camera (rather than
        a reader that forgot to drain). Linux-only — elsewhere it reports 0, and the
        trace simply says nothing.
        """
        sock = self._sock()
        if sock is None:
            return 0
        try:
            import fcntl
            import struct
            import termios

            return int(
                struct.unpack(
                    'I',
                    fcntl.ioctl(sock.fileno(), termios.FIONREAD, struct.pack('I', 0)),
                )[0]
            )
        except Exception:  # noqa: BLE001 — an unsupported platform is not a failure
            return 0

    def _extract(self):
        """Drain the buffer: the newest complete JPEG, or None when incomplete.

        Everything older than the newest frame in the buffer was already stale when
        it arrived, so it is counted in `skipped` and never decoded twice.
        """
        import cv2
        import numpy as np

        newest = None
        while True:
            start = self._buffer.find(self.SOI)
            if start < 0:
                # Nothing but multipart headers so far: keep a byte, in case the SOI
                # itself is split across two reads.
                self._buffer = self._buffer[-1:]
                break
            end = self._buffer.find(self.EOI, start + 2)
            if end < 0:
                if start > 0:
                    self._buffer = self._buffer[start:]
                break

            jpeg = self._buffer[start : end + 2]
            self._buffer = self._buffer[end + 2 :]
            # A corrupt frame is skipped, never fatal: the next boundary is still
            # ahead of us in the stream.
            frame = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                continue
            if newest is not None:
                self.skipped += 1
            newest = frame
        return newest

    def close(self) -> None:
        if self._res is not None:
            try:
                self._res.close()
            except Exception:  # noqa: BLE001
                pass
            self._res = None
        self._buffer = b''


def source_for(source: dict) -> FrameSource:
    """The (unopened) source a brain feed descriptor maps to.

    Pure: it only *builds* the source, so the kind → class/argument mapping is
    testable without a camera or a stream.
    """
    kind = (source or {}).get('kind')
    url = (source or {}).get('url', '')
    if kind == 'webcam':
        return WebcamSource(int(url or 0))
    if kind == 'rtsp':
        return UrlSource(url)
    if kind == 'mjpeg':
        return MjpegSource(url)
    if kind == 'ha':
        return SnapshotSource(url, (source or {}).get('token', ''))
    raise NotImplementedError(f'feed source {kind!r} not supported yet')


def feed_source(feed: dict, brain_url: str, token: str = '') -> dict:
    """The descriptor to open for one brain feed.

    A **relayed** feed (`mjpeg` / `ha`) is read *through the brain*: an mjpeg URL
    is frequently host-local (a webcam helper on `127.0.0.1`, an app the
    container cannot route to) and an HA proxy needs a token — the brain adds it
    server-side and streams the body back.

    The service token rides in the **query string** because `cv2.VideoCapture`
    cannot send a header; the brain's gate accepts one on that route only.
    """
    source = dict(feed.get('source') or {})
    camera_id = feed.get('cameraId')
    if not feed.get('relay') or not camera_id:
        return source

    url = f'{brain_url.rstrip("/")}/api/vision/feeds/{camera_id}/stream'
    if token:
        url = f'{url}?token={quote(token, safe="")}'
    # The kind still decides how frames are read (a stream, or one JPEG a read).
    return {'kind': source.get('kind'), 'url': url}


def open_feed(source: dict) -> FrameSource:
    """Open a brain feed descriptor (`{ kind, url, token? }`)."""
    return source_for(source).open()
