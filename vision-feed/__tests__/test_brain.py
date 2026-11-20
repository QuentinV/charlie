"""`brain`: the tri-state of a feed poll.

`fetch_feeds` has three answers, not two: the list of feeds, `[]` for "the brain
answered and no camera selected a mode", and `None` for "the brain did not answer".
Collapsing the last two is what made a brain restart stop every camera — and each
one re-paid its detector and recognizer load on the way back — for an outage that
lasted a second (`main.run_brain`, `loop.feeds_to_stop`).
"""
import brain


def _stub(monkeypatch, answer=None, error=None):
    """Replace the HTTP call: no brain, no network, no token file."""

    def fake_request(method, path, body=None, timeout=10):
        assert method == 'GET' and path == 'vision/feeds'
        if error is not None:
            raise error
        return answer

    monkeypatch.setattr(brain, '_request', fake_request)


def test_an_answered_poll_returns_the_feeds(monkeypatch):
    _stub(monkeypatch, {'feeds': [{'cameraId': 'c1'}, {'cameraId': 'c2'}]})

    assert brain.fetch_feeds() == [{'cameraId': 'c1'}, {'cameraId': 'c2'}]


def test_no_camera_selected_is_an_empty_list(monkeypatch):
    """A real answer: the selection is empty, so the feeds may be stopped."""
    _stub(monkeypatch, {})

    assert brain.fetch_feeds() == []


def test_an_unreachable_brain_is_none_not_empty(monkeypatch):
    """The distinction the whole fix rests on: unknown is not "no cameras"."""
    _stub(monkeypatch, error=OSError('connection refused'))

    assert brain.fetch_feeds() is None


def test_a_brain_erroring_with_a_body_is_still_none(monkeypatch):
    """A 500 with a JSON body is not an answer about the cameras either."""
    _stub(monkeypatch, error=ValueError('HTTP Error 500'))

    assert brain.fetch_feeds() is None
