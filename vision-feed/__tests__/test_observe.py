"""`pipeline.observe`: what the trace prints and what the debug UI draws.

The stats, the counters and the ring are stdlib; `annotate` / `encode_jpeg` need cv2
(the same lazy dependency as the rest of `pipeline/`). The assertions that matter are
the *drawing* ones — a box that changes colour is a new id, which is how the UI makes
churn visible instead of a number in a log — plus the MJPEG part, checked by feeding it
back through the reader that consumes the brain's own relayed stream
(`sources.MjpegSource`): the debug UI must not produce a stream nothing can read.
"""
import json

import numpy as np

from pipeline import observe
from pipeline.sources import MjpegSource

BOX = (10.0, 20.0, 110.0, 220.0)


def _stats(**kwargs):
    base = dict(
        at=1.0,
        wall=1.7e9,
        frame_no=7,
        fps=4.9,
        motion=True,
        gate_score=0.42,
        detected=True,
    )
    base.update(kwargs)
    return observe.FrameStats(**base)


def test_the_debug_line_names_the_three_track_states():
    """`#1 person` confirmed, `#2 cat~` carried, `#3 dog*` born on this frame.

    Those three states are exactly what the enter/leave churn confused, so the line
    spells them out rather than showing a count.
    """
    stats = _stats(
        tracks=[(1, 'person', True, BOX), (2, 'cat', False, BOX), (3, 'dog', True, BOX)],
        born=(3,),
        events=[('enter', 3, 'dog')],
    )
    line = observe.debug_line(stats)

    assert '#1 person' in line
    assert '#2 cat~' in line
    assert '#3 dog*' in line
    assert 'events enter#3' in line
    assert 'gate=motion:0.42' in line


def test_the_debug_line_says_when_the_detector_did_not_look():
    """A frame the detector skipped carries no information — and the line says so."""
    line = observe.debug_line(_stats(detected=False, motion=False, gate_score=0.0))
    assert 'det=no' in line
    assert 'tracks' not in line


def test_the_debug_line_shows_the_pending_enter_and_the_raw_gesture():
    stats = _stats(pending={4: 1}, gesture={'hands': 1, 'top': 'None', 'score': 0.97})
    line = observe.debug_line(stats)

    assert 'pending #4:1' in line
    assert 'gesture None 0.97 hands=1' in line
    # An answer without the landmark columns keeps the line it always had.
    assert 'rules=' not in line


def test_the_debug_line_shows_what_the_geometry_spelled():
    """The raw answer says "a hand, no category" — the rules column says the rest.

    `tracked=1 rules=Stop` next to `top=None` is the whole diagnosis of a sign the model
    does not know but the geometry does; without it, the trace of a working `Stop` looks
    identical to a camera that sees nothing.
    """
    stats = _stats(
        gesture={
            'hands': 1,
            'top': 'None',
            'score': 0.97,
            'landmarks': 1,
            'rules': ['Stop'],
        }
    )
    line = observe.debug_line(stats)
    assert 'gesture None 0.97 hands=1 tracked=1 rules=Stop motion=-' in line


def test_the_debug_line_shows_a_movement_the_tier_spelled():
    """The two tiers are named apart because they decide apart.

    The rules column is voted on, a trajectory is published as it fires; a trace that
    merged them could not tell "the tier found nothing" from "the tier found a swipe
    and the vote dropped it" — which is exactly what happened.
    """
    stats = _stats(
        gesture={
            'hands': 1,
            'top': 'None',
            'score': 0.4,
            'landmarks': 1,
            'rules': [],
            'motion': ['Swipe_Left'],
        }
    )
    assert 'tracked=1 rules=- motion=Swipe_Left' in observe.debug_line(stats)


def test_the_debug_line_shows_a_frame_whose_geometry_spelled_nothing():
    stats = _stats(
        gesture={'hands': 1, 'top': 'Victory', 'score': 0.8, 'landmarks': 1, 'rules': []}
    )
    assert 'rules=- motion=-' in observe.debug_line(stats)


def test_the_counters_make_the_churn_visible():
    """`enters`/`leaves` are the churn metric — and `tracks_minted` is not.

    The policy only emits for the classes the modes watch, while the tracker mints ids
    for every class it sees: a camera pointed at a room mints ids for the furniture the
    detector flickers on (measured: `bed`, `book`, `remote`), which emit nothing at all.
    `mintedByClass` is what tells the two apart.
    """
    counters = observe.Counters()
    counters.observe(_stats(at=1.0, tracks=[(1, 'person', True, BOX)]))
    counters.observe(
        _stats(
            at=2.0,
            tracks=[(1, 'person', True, BOX)],
            events=[('dwell', 1, 'person')],
        )
    )
    counters.observe(
        _stats(
            at=3.0,
            tracks=[(2, 'person', True, BOX)],
            events=[('enter', 2, 'person')],
        )
    )
    counters.observe(_stats(at=4.0, tracks=[(3, 'bed', True, BOX)]))
    counters.observe(_stats(at=5.0, tracks=[], events=[('leave', 2, 'person')]))

    summary = counters.summary()
    assert summary['frames'] == 5
    assert summary['enters'] == 1
    assert summary['leaves'] == 1
    assert summary['dwells'] == 1
    assert summary['entersByClass'] == {'person': 1}
    assert summary['leavesByClass'] == {'person': 1}
    assert summary['dwellsByClass'] == {'person': 1}
    # The bed was tracked (and never announced), so it counts as an id but no event.
    assert summary['tracksMinted'] == 3
    assert summary['mintedByClass'] == {'person': 2, 'bed': 1}
    assert summary['longestTrackS'] == 1.0


def test_the_ring_keeps_the_newest_and_is_bounded():
    ring = observe.Ring(size=3)
    for i in range(5):
        ring.append(i)

    assert len(ring) == 3
    assert ring.recent() == [4, 3, 2]  # newest first
    assert ring.recent(2) == [4, 3]
    ring.clear()
    assert ring.recent() == []


def test_to_dict_is_json_ready():
    """The UI polls it: a non-serialisable field would blank the page, not error."""
    stats = _stats(
        detections=[('person', 0.87, BOX)],
        tracks=[(1, 'person', True, BOX)],
        born=(1,),
        events=[('enter', 1, 'person')],
        gesture={'hands': 1, 'top': 'Victory', 'score': 0.6},
    )
    payload = json.loads(json.dumps(stats.to_dict()))

    assert payload['tracks'][0]['id'] == 1
    assert payload['tracks'][0]['box'] == [10, 20, 110, 220]
    assert payload['born'] == [1]
    assert payload['gesture']['top'] == 'Victory'


def test_color_for_is_stable_per_id_and_cycles():
    """A box that changes colour is a new id — so the mapping must not drift."""
    assert observe.color_for(1) == observe.color_for(1)
    assert observe.color_for(1) == observe.PALETTE[0]
    assert observe.color_for(len(observe.PALETTE) + 1) == observe.PALETTE[0]
    assert observe.color_for(2) != observe.color_for(1)


def test_annotate_leaves_the_loop_frame_untouched():
    """`copy=True` is what lets a stream handler draw on a frame the loop still owns."""
    frame = np.full((240, 320, 3), 128, dtype=np.uint8)
    before = frame.copy()
    stats = _stats(tracks=[(1, 'person', True, BOX)], born=(1,))

    drawn = observe.annotate(frame, stats)

    assert drawn is not frame
    assert drawn.shape == frame.shape
    assert np.array_equal(frame, before)  # the loop's frame is intact


def test_annotate_can_draw_in_place():
    frame = np.full((240, 320, 3), 128, dtype=np.uint8)
    assert observe.annotate(frame, _stats(), copy=False) is frame


def test_annotate_survives_an_empty_frame_with_no_tracks():
    frame = np.zeros((32, 32, 3), dtype=np.uint8)
    drawn = observe.annotate(frame, _stats(tracks=[], detected=False))
    assert drawn.shape == frame.shape


def test_the_mjpeg_part_is_readable_by_the_service_reader():
    """The UI's own stream must be readable by `sources.MjpegSource`.

    That reader is what consumes the brain's relayed MJPEG, so the round trip is the
    proof that the debug UI cannot emit a stream the service itself would choke on.
    """
    frame = np.full((64, 96, 3), 200, dtype=np.uint8)
    jpeg = observe.encode_jpeg(frame, quality=80)
    assert jpeg and jpeg[:2] == b'\xff\xd8' and jpeg[-2:] == b'\xff\xd9'

    reader = MjpegSource('http://127.0.0.1:9313/stream.mjpg')
    reader._buffer = observe.mjpeg_part(jpeg)
    decoded = reader._extract()

    assert decoded is not None
    assert decoded.shape[:2] == (64, 96)


def test_the_trace_names_the_frames_the_source_passed_over():
    """A live source is read newest-frame, so a backlog reading is visible as a number.

    `MjpegSource.skipped` counts the frames it dropped because a newer one had
    already arrived. It has to reach the trace and the JSON: "the picture is late" is
    otherwise invisible, which is exactly how the growing lag went unnoticed.
    """
    stats = _stats(source_skipped=4)

    assert 'src-skipped=4' in observe.debug_line(stats)
    assert stats.to_dict()['sourceSkipped'] == 4
    # Nothing to say when the reader kept up — the common case.
    assert 'src-skipped' not in observe.debug_line(_stats())


def test_the_trace_names_the_bytes_the_reader_could_not_drain():
    """The residual lag as bytes: 0 is healthy, a climbing number is a slow tick.

    `MjpegSource.pending()` reads `SIOCINQ` *after* the read, so whatever is left
    arrived after the frame that was taken — the floor of the picture's delay. It has
    to reach the trace and the JSON, or the container's constant lag stays invisible.
    """
    stats = _stats(source_backlog=300 * 1024)

    assert 'src-backlog=300k' in observe.debug_line(stats)
    assert stats.to_dict()['sourceBacklog'] == 300 * 1024
    # Kept up: nothing to say — the common case.
    assert 'src-backlog' not in observe.debug_line(_stats())
    # A small reading is shown as bytes rather than rounded away to "0k".
    assert 'src-backlog=200B' in observe.debug_line(_stats(source_backlog=200))


def test_display_copy_downscales_for_the_page_and_leaves_a_small_frame_alone():
    """One page-sized encode, not a full-resolution one per client.

    The debug UI drew and encoded every connected browser's own 1080p frame on the same
    cores the cascade runs on: the tool slowing down the feed it is measuring.
    """
    frame = np.full((1080, 1920, 3), 128, dtype=np.uint8)

    assert observe.display_copy(frame, 960).shape == (540, 960, 3)
    assert observe.display_copy(frame, 0) is frame  # off on request
    assert observe.display_copy(frame, 4000) is frame  # already smaller than asked


def test_the_converters_read_the_pipeline_objects():
    class D:
        cls = 'person'
        conf = 0.8
        box = BOX

    class T:
        id = 3
        cls = 'person'
        box = BOX
        matched = False

    class E:
        kind = 'dwell'
        track_id = 3
        cls = 'person'

    assert observe.detections_of([D()]) == [('person', 0.8, BOX)]
    assert observe.tracks_of([T()]) == [(3, 'person', False, BOX)]
    assert observe.events_of([E()]) == [('dwell', 3, 'person')]
    assert observe.detections_of(None) == []
