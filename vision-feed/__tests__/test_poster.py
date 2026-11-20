"""`pipeline.poster`: events leave the loop thread (a VLM call cannot stall it).

The regression this guards: escalation used to run **inline** in `run_feed`, so the
feed stopped reading frames for the whole describe call (10 s timeout, ~6.5 s
measured for the heavy model) — right after a gesture, which is exactly when the
next wave arrives.
"""
import threading
import time

from pipeline.poster import EventPoster


def test_events_are_posted_in_order():
    seen = []
    done = threading.Event()

    def post(payload):
        seen.append(payload['kind'])
        if len(seen) == 2:
            done.set()

    poster = EventPoster(post)
    poster.submit({'kind': 'enter'})
    poster.submit({'kind': 'gesture'})
    assert done.wait(2.0)
    poster.close()
    assert seen == ['enter', 'gesture']


def test_submit_never_blocks_on_a_slow_escalation():
    """The loop keeps sampling while the VLM answers."""
    started = threading.Event()
    release = threading.Event()
    posted = []

    def escalate(frame):
        started.set()
        release.wait(2.0)
        return {
            'tier': 'fast',
            'text': 'une personne qui salue',
            'keyframeUrl': '/api/vision/keyframes/x.jpg',
        }

    poster = EventPoster(posted.append, escalate=escalate)
    t0 = time.monotonic()
    poster.submit({'kind': 'gesture'}, frame=object())
    poster.submit({'kind': 'enter'})  # a later event must not wait either
    assert time.monotonic() - t0 < 0.5
    assert started.wait(2.0)

    # The described event is posted with its description, then the next one.
    release.set()
    poster.close()
    assert [p['kind'] for p in posted] == ['gesture', 'enter']
    assert posted[0]['vlm'] == {'tier': 'fast', 'text': 'une personne qui salue'}
    assert posted[0]['keyframeUrl'] == '/api/vision/keyframes/x.jpg'


def test_an_event_without_a_frame_skips_the_escalation():
    calls = []

    def escalate(frame):
        calls.append('escalated')
        return {'text': 'never'}

    poster = EventPoster(calls.append, escalate=escalate)
    poster.submit({'kind': 'enter'})
    poster.close()
    assert calls == [{'kind': 'enter'}]


def test_a_failing_escalation_still_posts_the_event():
    posted = []

    def boom(frame):
        raise RuntimeError('brain unreachable')

    poster = EventPoster(posted.append, escalate=boom)
    poster.submit({'kind': 'enter'}, frame=object())
    poster.close()
    assert posted == [{'kind': 'enter'}]


def test_a_saturated_queue_drops_instead_of_blocking():
    """A camera that outruns the brain loses an event, never its cadence."""
    gate = threading.Event()

    def post(payload):
        gate.wait(2.0)

    poster = EventPoster(post, maxsize=1)
    poster.submit({'kind': 'a'})
    for i in range(5):
        poster.submit({'kind': f'x{i}'})
    assert poster.dropped >= 1
    gate.set()
    poster.close()


def test_close_is_idempotent():
    posted = []
    poster = EventPoster(posted.append)
    poster.submit({'kind': 'enter'})
    poster.close()
    poster.close()
    assert posted == [{'kind': 'enter'}]
