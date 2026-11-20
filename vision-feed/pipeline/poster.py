"""Event posting, off the feed thread.

`run_feed` used to escalate *inline*: an escalating event (`enter`/`dwell`/
`appear`/`gesture` for a class an escalating mode watches) called the VLM before
the event was even posted. That blocked the single feed thread for the whole call
— the brain's describe timeout is 10 s and the heavy model measures ~6.5 s — so
the camera was deaf right after a gesture, which is precisely when the next wave
arrives. Posting from a worker keeps the loop reading frames; the payload is
unchanged and events keep their order.

Testable without a brain: the worker only calls the two callables it is given.
"""
import queue
import threading

#: Bound on queued events. A camera that outruns the brain (or a slow VLM) drops
#: its oldest event rather than the loop's cadence: a feed that stops sampling is
#: worse than a missed event. An escalation holds one frame reference until it is
#: handled.
MAX_QUEUE = 8


class EventPoster:
    """Posts events on a worker thread, escalation included."""

    def __init__(self, post, escalate=None, maxsize: int = MAX_QUEUE):
        self._post = post
        self._escalate = escalate
        self._queue: queue.Queue = queue.Queue(maxsize=maxsize)
        self._dropped = 0
        self._closed = False
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def submit(self, payload: dict, frame=None) -> None:
        """Queue one event. Never blocks; drops (and counts) when saturated."""
        try:
            self._queue.put_nowait((dict(payload), frame))
        except queue.Full:
            self._dropped += 1

    @property
    def dropped(self) -> int:
        """Events lost to a saturated queue (0 in normal operation)."""
        return self._dropped

    def _run(self) -> None:
        while True:
            item = self._queue.get()
            if item is None:
                return
            payload, frame = item
            # The escalation is guarded on its own: a VLM that fails (or times
            # out) must never lose the event it was describing.
            if self._escalate is not None and frame is not None:
                try:
                    info = self._escalate(frame)
                    if info:
                        payload['vlm'] = {
                            'tier': info.get('tier', 'fast'),
                            'text': info['text'],
                        }
                        if info.get('keyframeUrl'):
                            payload['keyframeUrl'] = info['keyframeUrl']
                except Exception as e:  # noqa: BLE001
                    print(f'[feed] escalation failed: {e}')
            try:
                self._post(payload)
            except Exception as e:  # noqa: BLE001
                # A poster must never die: one bad event cannot silence a camera.
                print(f'[feed] event post failed: {e}')

    def close(self, timeout: float = 5.0) -> None:
        """Drain and stop the worker (called when the feed stops)."""
        if self._closed:
            return
        self._closed = True
        try:
            self._queue.put(None, timeout=timeout)
        except queue.Full:
            pass
        self._thread.join(timeout=timeout)
