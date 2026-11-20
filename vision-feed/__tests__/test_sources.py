"""Source mapping tests — pure: each source is *built*, never opened.

The brain hands `vision-feed` a feed descriptor (`{ kind, url, token? }`); this
is the one place that decides which source class (and which argument) it maps
to, so a wrong mapping (an index read as a URL, a lost token) is caught here
rather than on a camera in the house.

The MJPEG reader is tested on a synthetic multipart stream (its `opener` is
injected): it is the fix for the desync `cv2.VideoCapture` hits when a consumer
pauses, which left the camera deaf with no error at all.
"""
#: The reader drains its socket on every call (a live frame is dropped, never queued,
#: on this hop too): the tests below put a *real* `socketpair` behind it, because the
#: backlog that made the container's picture seconds late lives in the kernel, not in
#: any Python buffer a fake could model.
import socket
import sys


import pytest

from pipeline.sources import (
    MjpegSource,
    SnapshotSource,
    UrlSource,
    WebcamSource,
    feed_source,
    source_for,
)


def test_a_relayed_feed_is_read_on_the_brain():
    feed = {
        'cameraId': 'cam-1',
        'relay': True,
        'source': {'kind': 'mjpeg', 'url': 'http://127.0.0.1:9312/video.mjpg'},
    }

    assert feed_source(feed, 'http://api:9300') == {
        'kind': 'mjpeg',
        'url': 'http://api:9300/api/vision/feeds/cam-1/stream',
    }


def test_the_service_token_rides_in_the_query_string():
    # cv2 cannot send a header, so the token has to be in the URL (encoded).
    feed = {'cameraId': 'cam-1', 'relay': True, 'source': {'kind': 'ha'}}

    assert feed_source(feed, 'http://api:9300', 'chk_a/b')['url'] == (
        'http://api:9300/api/vision/feeds/cam-1/stream?token=chk_a%2Fb'
    )


def test_a_direct_feed_keeps_its_own_source():
    source = {'kind': 'rtsp', 'url': 'rtsp://cam/stream'}
    feed = {'cameraId': 'cam-1', 'relay': False, 'source': source}

    assert feed_source(feed, 'http://api:9300') == source


def test_a_relayed_feed_without_a_camera_id_is_left_alone():
    source = {'kind': 'mjpeg', 'url': 'http://cam/video'}

    assert feed_source({'relay': True, 'source': source}, 'http://api:9300') == source


def test_a_trailing_slash_on_the_brain_url_is_tolerated():
    feed = {'cameraId': 'c', 'relay': True, 'source': {'kind': 'mjpeg'}}

    assert feed_source(feed, 'http://api:9300/')['url'] == (
        'http://api:9300/api/vision/feeds/c/stream'
    )


def test_the_kind_still_picks_the_reader():
    mjpeg = feed_source(
        {'cameraId': 'c', 'relay': True, 'source': {'kind': 'mjpeg'}},
        'http://api:9300',
    )
    assert isinstance(source_for(mjpeg), MjpegSource)

    # An HA proxy answers one JPEG per request, so it is polled, not streamed.
    ha = feed_source(
        {'cameraId': 'c', 'relay': True, 'source': {'kind': 'ha'}},
        'http://api:9300',
    )
    assert isinstance(source_for(ha), SnapshotSource)


def test_webcam_index_is_parsed_from_the_url():
    src = source_for({'kind': 'webcam', 'url': '2'})
    assert isinstance(src, WebcamSource)
    assert src.index == 2


def test_webcam_defaults_to_index_zero():
    assert source_for({'kind': 'webcam'}).index == 0
    assert source_for({'kind': 'webcam', 'url': ''}).index == 0


def test_rtsp_is_an_opencv_stream():
    src = source_for({'kind': 'rtsp', 'url': 'rtsp://cam/stream'})
    assert isinstance(src, UrlSource)
    assert src.url == 'rtsp://cam/stream'


def test_mjpeg_is_read_by_the_marker_reader():
    """Not by cv2's ffmpeg demuxer, which desyncs when a consumer pauses."""
    src = source_for({'kind': 'mjpeg', 'url': 'http://cam/video.mjpg'})
    assert isinstance(src, MjpegSource)
    assert src.url == 'http://cam/video.mjpg'


def test_ha_is_a_snapshot_carrying_the_token():
    src = source_for(
        {
            'kind': 'ha',
            'url': 'http://ha:8123/api/camera_proxy/camera.fridge',
            'token': 'chk_service',
        }
    )
    assert isinstance(src, SnapshotSource)
    assert src.url == 'http://ha:8123/api/camera_proxy/camera.fridge'
    assert src.token == 'chk_service'


def test_ha_without_a_token_stays_empty():
    assert source_for({'kind': 'ha', 'url': 'u'}).token == ''


def test_unknown_or_missing_kind_is_refused():
    with pytest.raises(NotImplementedError):
        source_for({'kind': 'echo'})
    with pytest.raises(NotImplementedError):
        source_for({})


def _jpeg(value: int = 0) -> bytes:
    """A real, decodable JPEG (the reader decodes each frame with cv2).

    `value` is the grey level of the whole frame, so the frame a read returns can be
    identified (`frame.mean()`), which is what pins "newest, not oldest".
    """
    import cv2
    import numpy as np

    ok, buf = cv2.imencode('.jpg', np.full((8, 8, 3), value, np.uint8))
    assert ok
    return buf.tobytes()


class FakeStream:
    """A file-like stand-in for an HTTP response (`chunk` caps each read)."""

    def __init__(self, data: bytes, chunk: int = 0):
        self.data = data
        self.chunk = chunk
        self.pos = 0
        self.closed = False

    def read(self, n=-1):
        size = len(self.data) - self.pos if n is None or n < 0 else n
        if self.chunk:
            size = min(size, self.chunk)
        out = self.data[self.pos : self.pos + size]
        self.pos += len(out)
        return out

    def close(self):
        self.closed = True


def _mjpeg_body(*frames: bytes) -> bytes:
    """The multipart body a camera server writes for `frames`."""
    return b''.join(
        b'\r\n--boundary\r\nContent-Type: image/jpeg\r\n\r\n' + f for f in frames
    )


def _mjpeg(*frames: bytes, chunk: int = 0) -> FakeStream:
    """A multipart body carrying `frames`, as a camera server writes it."""
    return FakeStream(_mjpeg_body(*frames), chunk=chunk)


def _open(stream) -> MjpegSource:
    return MjpegSource('http://cam/video.mjpg', opener=lambda url, h: stream).open()


def test_the_marker_reader_serves_the_newest_frame_not_the_buffer():
    """A read drains the buffer: the *newest* frame, and the older ones dropped.

    This is the consumer half of "nobody may queue". `read()` used to pop the oldest
    complete JPEG, so a reader paced below the camera (the loop's `VISION_FEED_FPS`)
    analysed a frame the feed had already moved past — and the lag grew with the
    buffer rather than settling at one interval.
    """
    src = _open(_mjpeg(_jpeg(10), _jpeg(200)))

    frame = src.read()
    assert frame is not None
    assert frame.shape == (8, 8, 3)
    assert frame.mean() > 100  # the second frame, i.e. the newest
    assert src.skipped == 1

    # Both frames were in the one chunk, and the buffer is now empty: the stream is
    # over, which the loop turns into a reopen.
    assert src.read() is None


def test_the_reader_survives_a_frame_split_across_reads():
    """The desync the probe hit: boundaries and JPEGs arriving mid-chunk.

    `cv2.VideoCapture` answered `None` *forever* here (ffmpeg's mpjpeg demuxer
    printed "Expected boundary '--' not found"); the marker reader just keeps
    buffering.
    """
    jpeg = _jpeg()
    src = _open(_mjpeg(jpeg, jpeg, chunk=7))

    assert src.read() is not None
    assert src.read() is not None


def test_a_stream_that_ends_without_a_complete_frame_is_none():
    assert _open(FakeStream(b'\r\n--b\r\n')).read() is None


def test_reading_before_open_is_none():
    assert MjpegSource('http://cam/video.mjpg').read() is None


def test_a_failing_read_is_none_not_an_exception():
    """A stalled socket (urllib's timeout) must not kill the feed thread."""

    class Boom:
        def read(self, n=-1):
            raise OSError('socket timeout')

        def close(self):
            pass

    assert _open(Boom()).read() is None


def test_close_closes_the_stream():
    stream = _mjpeg(_jpeg())
    src = _open(stream)
    src.close()
    assert stream.closed is True


class LiveStream:
    """A socket-backed stand-in for an HTTP response — the drain, made real.

    A `socketpair` gives `select` something genuine to report on and `read1` real bytes
    to hand over, which is the whole point: "the reader emptied its transport" cannot be
    shown by a byte array in a list, and the bytes it left behind are exactly what used
    to come back as a picture seconds old.
    """

    def __init__(self):
        self.sock, self.peer = socket.socketpair()
        self.fp = self.sock.makefile('rb')

    def feed(self, data: bytes) -> None:
        self.peer.sendall(data)

    def read(self, n=-1):  # only a fallback: a real response exposes `read1`
        return self.fp.read(n)

    def close(self):
        self.fp.close()
        self.sock.close()
        self.peer.close()


def _live(stream, **kwargs) -> MjpegSource:
    return MjpegSource(
        'http://cam/video.mjpg', opener=lambda url, h: stream, **kwargs
    ).open()


def test_one_read_empties_the_socket_however_many_frames_it_holds():
    """`read()` takes the whole backlog in one call, not one read size of it.

    The loop pulled a single `chunk` per tick and returned, which capped intake at
    `chunk × loop fps` (320 KB/s at the loop's 5 fps against a 64 KB chunk). A camera
    publishing more than that left everything else in the kernel's receive buffer —
    megabytes of it on Linux, i.e. a picture seconds old, invisible both to the
    publisher (Node user-space) and to `skipped` (those frames were never read).
    """
    stream = LiveStream()
    stream.feed(_mjpeg_body(*[_jpeg(n * 20 + 20) for n in range(8)]))

    src = _live(stream)
    frame = src.read()

    assert frame is not None
    assert frame.mean() > 100  # the last frame of the batch (160), not the first (20)
    assert src.skipped == 7
    assert src.pending() == 0  # nothing was left waiting in the socket


def test_a_backlog_spanning_many_reads_still_arrives_in_one():
    """The old ceiling was the read size, so a backlog bigger than it must still go."""
    stream = LiveStream()
    stream.feed(_mjpeg_body(*([_jpeg(10), _jpeg(200)] * 10)))  # ~6 KB, in 512-byte reads

    src = _live(stream, chunk=512)
    frame = src.read()

    assert frame is not None and frame.mean() > 100
    assert src.skipped == 19
    assert src.pending() == 0


@pytest.mark.skipif(
    sys.platform.startswith('win'), reason='SIOCINQ comes from termios (Linux)'
)
def test_pending_reports_the_bytes_the_reader_would_have_left_behind():
    """The residual lag as a number: bytes still unread *after* the read."""
    stream = LiveStream()
    src = _live(stream)
    stream.feed(_mjpeg_body(_jpeg(10), _jpeg(20)))

    assert src.pending() > 0  # fed, not read yet
    src.read()
    assert src.pending() == 0


def test_pending_is_zero_when_the_transport_cannot_say():
    """A file-like double has no socket, and an unopened source none at all: 0, no crash."""
    assert _open(_mjpeg(_jpeg())).pending() == 0
    assert MjpegSource('http://cam/video.mjpg').pending() == 0
