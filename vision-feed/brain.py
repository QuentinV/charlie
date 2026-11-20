"""Brain client: poll the feed list, post events.

The brain (nodejs-apis) owns the camera registry and the policy; this service
only polls `GET /api/vision/feeds` and posts to `POST /api/vision/events`. Pure
stdlib (urllib) so the container needs no extra HTTP dependency.
"""
import json
import urllib.request

import config


def _headers():
    headers = {'Content-Type': 'application/json'}
    token = config.brain_token()
    if token:
        headers['Authorization'] = f'Bearer {token}'
    return headers


def _request(method, path, body=None, timeout=10):
    url = f'{config.BRAIN_URL}/api/{path}'
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=_headers(), method=method)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        raw = res.read().decode() or '{}'
        return json.loads(raw)


def fetch_feeds():
    """The cameras that selected vision modes — `None` when the brain did not answer.

    Three states, not two: a list of feeds, `[]` for "the brain answered and no
    camera selected a mode", and `None` for "the brain did not answer at all". The
    caller must tell the last two apart — an unreachable brain is not a request to
    stop every camera (`main.run_brain`, `loop.feeds_to_stop`).
    """
    try:
        return _request('GET', 'vision/feeds').get('feeds', [])
    except Exception as e:  # noqa: BLE001
        print(f'[brain] feeds unavailable: {e}')
        return None


def post_event(event):
    """Report one semantic event; best effort (never crash the pipeline)."""
    try:
        _request('POST', 'vision/events', event)
    except Exception as e:  # noqa: BLE001
        print(f'[brain] event post failed: {e}')


def describe(image, prompt=None):
    """Ask the brain to describe a keyframe (fast VLM first, heavy fallback).

    The brain owns the model choice and the keyframe storage; returns the
    response dict (`{ ok, text, tier, keyframeUrl }`) or None.
    """
    try:
        return _request('POST', 'vision/describe', {'image': image, 'prompt': prompt})
    except Exception as e:  # noqa: BLE001
        print(f'[brain] describe failed: {e}')
        return None
