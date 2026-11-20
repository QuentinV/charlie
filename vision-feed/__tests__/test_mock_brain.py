"""`mock_brain`: the stub the debug UI runs the real service against.

A mock that drifts from the brain is worse than none: the UI would show a pipeline that
works against a payload the brain never sends. So the payload is asserted against the
*consumers* — `sources.feed_source`/`source_for` (the descriptor is opened directly, no
relay) and `brain.fetch_feeds`/`post_event` over real HTTP — and the mode mirror is
pinned against the brain's own table (`nodejs-apis/src/cameras/modes.ts`).
"""
import json
import threading
import urllib.request
from http.server import ThreadingHTTPServer

import brain
import config
import mock_brain
from pipeline.sources import MjpegSource, WebcamSource, feed_source, source_for

SOURCE = {'kind': 'mjpeg', 'url': 'http://127.0.0.1:9312/video.mjpg'}


class FakeState:
    """The two things `mock_brain._Handler` asks of its state."""

    def __init__(self, one_feed=None):
        self.ring = mock_brain.EventRing()
        self._feed = one_feed
        self.asks = 0

    def feed(self):
        self.asks += 1
        return self._feed


def _serve(state):
    """A mock brain on a free port (0), in a daemon thread."""
    server = ThreadingHTTPServer(('127.0.0.1', 0), mock_brain._Handler)
    server.daemon_threads = True
    server.state = state
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _get(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=5) as res:
        return json.loads(res.read().decode())


def _post(url, payload):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(request, timeout=5) as res:
        return json.loads(res.read().decode())


def test_the_feed_opens_the_camera_directly():
    """`relay: False` is what keeps the debug UI off the brain's passthrough.

    The descriptor is handed to `sources.source_for` unchanged, so the UI debugs the
    cascade and nothing else — and the same `feed_source` the container uses is the one
    under test.
    """
    feed = mock_brain.feed('debug-1', SOURCE, ['presence'])

    assert feed['relay'] is False
    assert feed['cameraId'] == 'debug-1'
    assert feed['source'] == SOURCE
    assert feed_source(feed, 'http://brain:9300', 'tok') == SOURCE
    assert isinstance(source_for(feed['source']), MjpegSource)


def test_a_webcam_feed_maps_to_the_device_index():
    feed = mock_brain.feed('debug-1', {'kind': 'webcam', 'url': '1'}, ['presence'])
    source = source_for(feed['source'])

    assert isinstance(source, WebcamSource)
    assert source.index == 1


def test_the_mode_mirror_matches_the_brains_table():
    """The ids, classes and dwells of `cameras/modes.ts`, pinned.

    A mirror that drifts silently would let the UI prove a policy the brain never
    resolves — the one thing a mock must not do.
    """
    assert set(mock_brain.MODE_IDS) == {
        'presence',
        'pet',
        'entrance',
        'grocery',
        'commands',
    }
    assert mock_brain.MODES['presence']['classes'] == ['person']
    assert mock_brain.MODES['presence']['dwellS'] == 15
    assert mock_brain.MODES['presence']['escalate'] is True
    assert mock_brain.MODES['pet']['classes'] == ['cat', 'dog']
    assert mock_brain.MODES['entrance']['dwellS'] == 3
    assert mock_brain.MODES['grocery']['dwellS'] == 20
    assert mock_brain.MODES['grocery']['grocery'] is True
    assert mock_brain.MODES['commands']['gestures'] is True
    assert mock_brain.MODES['commands']['dwellS'] == 60
    # No `off` row: an empty selection *is* off.
    assert 'off' not in mock_brain.MODES


def test_the_policy_takes_the_shortest_dwell_and_the_escalating_classes():
    policy = mock_brain.policy_of(['presence', 'entrance'])

    assert policy['classes'] == ['person']
    assert policy['dwellByClass'] == {'person': 3}  # entrance (3 s) wins
    assert policy['escalateClasses'] == ['person']
    assert policy['gestureModes'] == []
    assert policy['modesByClass'] == {'person': ['presence', 'entrance']}


def test_a_pet_camera_does_not_escalate_because_presence_does():
    """One engine per camera: the classes are per class, never the whole union."""
    policy = mock_brain.policy_of(['presence', 'pet'])

    assert policy['classes'] == ['person', 'cat', 'dog']
    assert policy['escalateClasses'] == ['person']  # not the cat, not the dog
    assert policy['dwellByClass'] == {'person': 15, 'cat': 10, 'dog': 10}


def test_the_gesture_modes_are_the_flag_and_the_tag():
    assert mock_brain.policy_of(['commands'])['gestureModes'] == ['commands']
    assert mock_brain.policy_of(['presence'])['gestureModes'] == []


def test_an_unknown_mode_is_ignored():
    assert mock_brain.policy_of(['presence', 'nope'])['classes'] == ['person']


def test_the_mode_options_feed_the_ui_picker():
    options = mock_brain.mode_options()

    assert [o['value'] for o in options] == list(mock_brain.MODE_IDS)
    assert all('label' in o and 'classes' in o for o in options)


def test_an_empty_selection_is_no_feed():
    """No mode selected = not analysed: the document is empty, and that is the switch."""
    assert mock_brain.feeds_document(None) == {'feeds': []}
    assert mock_brain.feeds_document({'cameraId': 'x'}) == {
        'feeds': [{'cameraId': 'x'}]
    }


def test_the_event_ring_counts_and_caps():
    ring = mock_brain.EventRing(size=2)
    ring.append({'kind': 'enter', 'trackId': 1})
    ring.append({'kind': 'gesture', 'classes': ['Victory']})
    ring.append({'kind': 'leave', 'trackId': 1})

    assert [e['kind'] for e in ring.recent()] == ['leave', 'gesture']  # newest first
    summary = ring.summary()
    assert summary['enters'] == 1
    assert summary['leaves'] == 1
    assert summary['gestures'] == 1
    assert summary['total'] == 3

    ring.clear()
    assert ring.recent() == [] and ring.summary()['total'] == 0


def test_the_real_client_talks_to_the_mock_brain(monkeypatch, tmp_path):
    """The service's own client, over real HTTP: paths, headers and payloads.

    This is the integration the debug UI depends on — `brain.fetch_feeds` and
    `brain.post_event` are the production code, and the mock has to satisfy them (the
    feed document included) or the UI would prove nothing.
    """
    feed = mock_brain.feed('debug-1', SOURCE, ['presence'])
    state = FakeState(feed)
    server = _serve(state)
    base = f'http://127.0.0.1:{server.server_address[1]}'
    token = tmp_path / 'vision-feed.token'
    token.write_text('chk_mock', encoding='utf-8')
    monkeypatch.setattr(config, 'BRAIN_URL', base)
    monkeypatch.setattr(config, 'BRAIN_TOKEN_FILE', str(token))
    monkeypatch.setattr(config, 'BRAIN_TOKEN_FILE_FALLBACK', str(tmp_path / 'no'))
    try:
        assert brain.fetch_feeds() == [feed]
        brain.post_event({'cameraId': 'debug-1', 'kind': 'enter', 'trackId': 1})
        brain.describe('jpeg-as-text')

        assert state.ring.recent()[0]['kind'] == 'enter'
        assert state.ring.summary()['describes'] == 1
        # The service token travelled (`auth/serviceToken.ts` writes it for us).
        assert state.ring.auth == 'Bearer chk_mock'
        assert state.asks >= 1
    finally:
        server.shutdown()
        server.server_close()


def test_no_mode_selected_answers_with_an_empty_list(monkeypatch):
    """The tri-state's middle case, from the mock: answered, and nothing selected."""
    state = FakeState(None)
    server = _serve(state)
    try:
        base = f'http://127.0.0.1:{server.server_address[1]}'
        monkeypatch.setattr(config, 'BRAIN_URL', base)
        assert brain.fetch_feeds() == []
    finally:
        server.shutdown()
        server.server_close()


def test_an_unanswered_poll_is_none_not_empty():
    """A dead mock brain must read as "unknown", never as "no cameras".

    The one distinction `main.run_brain` stops cameras on (`loop.feeds_to_stop`).
    """
    server = _serve(FakeState(None))
    port = server.server_address[1]
    server.shutdown()
    server.server_close()

    import config as cfg

    original = cfg.BRAIN_URL
    cfg.BRAIN_URL = f'http://127.0.0.1:{port}'
    try:
        assert brain.fetch_feeds() is None
    finally:
        cfg.BRAIN_URL = original


def test_the_http_routes_answer_the_shapes_the_client_expects():
    state = FakeState(mock_brain.feed('debug-1', SOURCE, ['commands']))
    server = _serve(state)
    try:
        base = f'http://127.0.0.1:{server.server_address[1]}'
        document = _get(f'{base}/api/vision/feeds', {'Authorization': 'Bearer t'})
        assert document['feeds'][0]['policy']['gestureModes'] == ['commands']

        assert _post(f'{base}/api/vision/events', {'kind': 'dwell'}) == {'ok': True}
        events = _get(f'{base}/api/vision/events')
        assert events['counts']['dwells'] == 1

        assert _post(f'{base}/api/vision/describe', {})['ok'] is True
        assert _post(f'{base}/api/vision/reset', {}) == {'ok': True}
        assert state.ring.recent() == []
    finally:
        server.shutdown()
        server.server_close()
