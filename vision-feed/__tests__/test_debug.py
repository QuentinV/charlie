"""`debug`: the local UI (live boxes + mocked brain), without a camera.

The state and the knob handling are tested directly; the HTTP surface is tested over a
real socket on a free port, because the page and the stream are the whole point — and
because a UI that answers the wrong shape would look like a broken cascade.

Nothing here needs a camera, a model or a brain: `on_frame` is called by hand with a
synthetic frame, exactly like `main.run_feed` would.
"""
import json
import threading
import urllib.error
import urllib.request

import numpy as np

import config
import debug
import mock_brain
from pipeline import observe

SOURCE = {'kind': 'mjpeg', 'url': 'http://127.0.0.1:9312/video.mjpg'}
BOX = (10.0, 20.0, 110.0, 220.0)


def _stats(**kwargs):
    base = dict(
        at=1.0,
        wall=1.7e9,
        frame_no=1,
        fps=4.0,
        motion=True,
        gate_score=0.4,
        detected=True,
        tracks=[(1, 'person', True, BOX)],
    )
    base.update(kwargs)
    return observe.FrameStats(**base)


def _state(**kwargs):
    return debug.DebugState(SOURCE, ['presence'], **kwargs)


def _get(url):
    with urllib.request.urlopen(url, timeout=5) as res:
        return res.read()


def test_the_knobs_are_written_to_the_config_and_can_be_read_back():
    """The UI's form and the feed read the same values — no second source of truth."""
    original = config.MISS_TTL_S
    try:
        applied = debug.set_knobs(
            {'missTtlS': '3.5', 'voteNeed': '2', 'detectConf': '0.25'}
        )
        assert applied == {'missTtlS': 3.5, 'voteNeed': 2, 'detectConf': 0.25}
        assert config.MISS_TTL_S == 3.5
        assert config.GESTURE_VOTE_NEED == 2
        assert config.DETECT_CONF == 0.25
        assert debug.read_knobs()['missTtlS'] == 3.5
    finally:
        config.MISS_TTL_S = original
        config.DETECT_CONF = 0.35
        config.GESTURE_VOTE_NEED = 3


def test_unknown_or_unusable_knobs_are_ignored():
    """A typo must not reach `setattr` (the UI is a form, not a shell)."""
    assert debug.set_knobs({'nope': 1}) == {}
    assert debug.set_knobs({'fps': 'soon'}) == {}
    assert debug.set_knobs({'fps': None, 'dwellS': ''}) == {}


def test_the_new_tiers_can_be_toggled_from_the_ui():
    """The two vocabulary tiers are switches, so a session can compare them live.

    Toggling `rules` off is the honest way to see what the canned model alone says about
    a sign the geometry spells — the calibration loop's other half.
    """
    rules, motion = config.GESTURE_RULES, config.GESTURE_MOTION
    try:
        applied = debug.set_knobs({'gestureRules': '0', 'gestureMotion': '0'})
        assert applied == {'gestureRules': 0, 'gestureMotion': 0}
        assert config.GESTURE_RULES == 0
        assert config.GESTURE_MOTION == 0
        assert debug.read_knobs()['gestureRules'] == 0
    finally:
        config.GESTURE_RULES, config.GESTURE_MOTION = rules, motion


def test_the_health_view_names_the_classifier_and_the_new_tiers():
    """A trained classifier is optional — and *silent* when nothing declared its labels.

    The page has to be able to say all three: the path it found, whether it is there, and
    the reason `pipeline/gesture.py` recorded when it refused to load it.
    """
    health = debug.probe_health()
    assert 'gestureClassifier' in health  # a path, or '—' when nothing is trained
    assert isinstance(health['gestureClassifierFound'], bool)
    # Found is not used: an artifact the feed refuses (a lone `.tflite` on the mediapipe we
    # ship) must never read as "ok" on the page.
    assert health['gestureClassifierUsed'] is False
    assert isinstance(health['gestureNote'], str)
    assert health['gestureRules'] is True
    assert health['gestureMotion'] is True


def test_the_mock_brain_serves_one_camera_and_the_selected_modes():
    state = _state()
    feed = state.feed()

    assert feed['cameraId'] == 'debug-1'
    assert feed['modes'] == ['presence']
    assert feed['relay'] is False
    assert feed['policy']['classes'] == ['person']


def test_no_mode_selected_serves_no_feed():
    """Empty selection = not analysed (`cameras/modes.ts` has no `off` row)."""
    assert debug.DebugState(SOURCE, []).feed() is None


def test_no_gestures_empties_the_policy_flag():
    """`--no-gestures` is the flag the feed reads, not a second code path."""
    state = _state(no_gestures=True)
    assert state.feed()['policy']['gestureModes'] == []


def test_applying_a_change_bumps_the_camera_and_resets_the_counters():
    """Restarting the feed is how `run_brain` is told: the old camera disappears.

    It also resets the counters, which is what makes "the run since I applied this" a
    meaningful number in the UI.
    """
    state = _state()
    state.on_frame(np.zeros((8, 8, 3), np.uint8), _stats(events=[('enter', 1, 'person')]))
    state.ring.append({'kind': 'enter'})

    result = state.apply(
        {'sourceKind': 'webcam', 'sourceUrl': '0', 'modes': ['commands'], 'knobs': {}}
    )

    assert result['cameraId'] == 'debug-2'
    assert state.camera_id == 'debug-2'
    assert state.source == {'kind': 'webcam', 'url': '0'}
    assert state.mode_ids == ['commands']
    assert state.feed()['policy']['gestureModes'] == ['commands']
    assert state.counters.summary()['enters'] == 0
    assert state.ring.summary()['total'] == 0
    assert state.snapshot()[0] is None


def test_applying_an_unknown_source_kind_keeps_the_current_one():
    state = _state()
    state.apply({'sourceKind': 'carrier-pigeon', 'modes': ['presence']})

    assert state.source['kind'] == 'mjpeg'


def test_the_observer_feeds_the_counters_the_ring_and_the_stream():
    state = _state()
    frame = np.full((16, 16, 3), 90, np.uint8)
    state.on_frame(frame, _stats(frame_no=1, events=[('enter', 1, 'person')]))
    state.on_frame(frame, _stats(at=2.0, frame_no=2))

    frame_ref, stats, seq = state.snapshot()
    assert frame_ref is frame
    assert stats.frame_no == 2
    assert seq == 2
    assert len(state.frames) == 2
    assert state.counters.summary()['tracksMinted'] == 1
    assert state.counters.summary()['enters'] == 1


def test_recording_writes_an_annotated_frame(tmp_path):
    state = _state()
    state.record_dir = str(tmp_path)
    state.record(np.full((16, 16, 3), 90, np.uint8), _stats())

    files = list(tmp_path.glob('frame_*.jpg'))
    assert len(files) == 1
    assert files[0].read_bytes()[:2] == b'\xff\xd8'


def test_a_broken_record_target_never_breaks_the_feed(tmp_path):
    state = _state()
    state.record_dir = str(tmp_path / 'file-not-a-dir')
    (tmp_path / 'file-not-a-dir').write_text('x', encoding='utf-8')

    state.record(np.zeros((8, 8, 3), np.uint8), _stats())  # must not raise

    assert state.record_dir is None
    assert any('record failed' in note for note in state.notes)


def test_the_config_view_describes_the_run():
    state = _state()
    view = state.config_view()

    assert view['cameraId'] == 'debug-1'
    assert view['source'] == SOURCE
    assert view['modes'] == ['presence']
    assert [o['value'] for o in view['modeOptions']] == list(mock_brain.MODE_IDS)
    assert view['sourceKinds'] == list(debug.SOURCE_KINDS)
    assert view['policy']['dwellByClass'] == {'person': 15}
    assert 'missTtlS' in view['knobs']


def _ui(state):
    """The UI server on a free port, in a daemon thread."""
    server = debug.build_server(state, 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f'http://127.0.0.1:{server.server_address[1]}'


def _post(url, payload):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(request, timeout=5) as res:
        return json.loads(res.read().decode())


def test_the_ui_serves_the_page_and_the_json_it_polls():
    state = _state()
    state.on_frame(
        np.zeros((8, 8, 3), np.uint8), _stats(events=[('enter', 1, 'person')])
    )
    state.ring.append({'kind': 'enter', 'trackId': 1})
    server, base = _ui(state)
    try:
        page = _get(f'{base}/').decode()
        assert 'vision-feed' in page
        assert '/stream.mjpg' in page

        stats = json.loads(_get(f'{base}/api/stats'))
        assert stats['counters']['tracksMinted'] == 1
        assert stats['latest']['tracks'][0]['id'] == 1
        assert stats['frames'][0]['frame'] == 1

        assert json.loads(_get(f'{base}/api/config'))['cameraId'] == 'debug-1'

        events = json.loads(_get(f'{base}/api/events'))
        assert events['counts']['enters'] == 1
        assert events['events'][0]['kind'] == 'enter'
    finally:
        server.shutdown()
        server.server_close()


def test_the_ui_applies_a_change_and_resets():
    state = _state()
    server, base = _ui(state)
    try:
        result = _post(
            f'{base}/api/apply',
            {
                'sourceKind': 'webcam',
                'sourceUrl': '0',
                'modes': ['commands'],
                'knobs': {'dwellS': '5'},
            },
        )
        assert result['cameraId'] == 'debug-2'
        assert result['applied'] == {'dwellS': 5.0}
        assert result['modes'] == ['commands']
        assert _post(f'{base}/api/reset', {}) == {'ok': True}
    finally:
        server.shutdown()
        server.server_close()


def test_the_ui_streams_an_annotated_mjpeg():
    """The part shape an `<img>` needs, read line by line off the socket."""
    state = _state()
    state.on_frame(np.full((32, 48, 3), 120, np.uint8), _stats())
    server, base = _ui(state)
    try:
        with urllib.request.urlopen(f'{base}/stream.mjpg', timeout=5) as res:
            assert res.headers['Content-Type'].startswith(
                'multipart/x-mixed-replace'
            )
            # One multipart part: `--frame`, its headers, a blank line, the JPEG.
            assert res.readline().strip() == b'--frame'
            headers = {}
            while True:
                line = res.readline()
                if line in (b'\r\n', b'\n', b''):
                    break
                name, _, value = line.decode().partition(':')
                headers[name.strip().lower()] = value.strip()

            assert headers['content-type'] == 'image/jpeg'
            jpeg = res.read(int(headers['content-length']))
            assert jpeg[:2] == b'\xff\xd8'
            assert jpeg[-2:] == b'\xff\xd9'
    finally:
        server.shutdown()
        server.server_close()


def test_an_unknown_route_is_a_404():
    state = _state()
    server, base = _ui(state)
    try:
        try:
            _get(f'{base}/api/nope')
            raise AssertionError('expected a 404')
        except urllib.error.HTTPError as e:
            assert e.code == 404
    finally:
        server.shutdown()
        server.server_close()
