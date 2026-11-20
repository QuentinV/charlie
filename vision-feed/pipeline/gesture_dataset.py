"""The recorded-sample dataset: what `recorder.py` writes and `probe_gestures.py` reads.

The two scripts at the repo root are the I/O and the recognizer; everything that can be
wrong *silently* lives here, pure and unit-tested:

- the crop geometry (`hand_box`): a crop that clips the hand teaches the trainer a hand
  at the edge of the frame, and a crop that is too tight leaves the detector nothing to
  find;
- the record shape (`read_records`): a line that does not validate is **skipped**, never
  a crash in the middle of a probe;
- the per-label summary (`summarize`): the numbers the thresholds in `hands.py`,
  `gesture_rules.py` and `gesture_motion.py` are calibrated against, so moving one is a
  measurement instead of a guess.

Layout on disk (one directory, gitignored, never baked into the image):

    dataset/
      landmarks.jsonl         one JSON object per kept frame
      Stop/1731000000_0.jpg   the padded crop that frame produced
      none/1731000001_0.jpg   a relaxed hand — the trained classifier needs a negative class

Why both: Model Maker's gesture classifier trains on **images** (it detects the hand and
runs the gesture embedder itself), while the geometric and motion rules are thresholds
over **landmarks**. One frame yields both, so the dataset answers both questions — "what
does the model say about this sign" and "what does this sign measure".

A `label` is the name the user was performing, not what the model said: the model's
answer is recorded next to it (`top`, `score`, `rules`), which is what makes a probe
report "the canned model already calls this `Open_Palm` 7 times out of 12" — the
evidence for deciding whether a label needs training at all.
"""
import json
import math
from dataclasses import dataclass

from pipeline.hands import FINGERS, INDEX_TIP, Hand, hand_from_landmarks

#: The keys a record must carry to be usable: the label performed and the landmarks.
REQUIRED_KEYS = ('label', 'landmarks')
#: The four long fingers, in the order the tip gaps are measured.
LONG = ('index', 'middle', 'ring', 'pinky')


@dataclass(frozen=True)
class _Point:
    """A landmark shaped like MediaPipe's (`x`, `y`, `z`), so `Hand` reads it."""

    x: float
    y: float
    z: float = 0.0


def hand_box(points, width: int, height: int, margin: float = 0.35) -> tuple:
    """The square pixel crop around a hand's landmarks, clamped to the frame.

    `points` are normalized landmarks (0..1 in the image), so the same hand at 1 m and
    at 3 m yields the same *relative* crop. The box is **square** and padded by
    `margin` of its own side: the gesture classifier's hand detector needs palm context
    around the hand, and a tight crop makes it fail — a hand at the edge of a tight crop
    is the classic "the dataset trains but the model sees nothing" bug.

    Returns `(x0, y0, x1, y1)` with `x1 > x0`, `y1 > y0` inside the frame.
    """
    xs = [float(point[0]) for point in points or ()]
    ys = [float(point[1]) for point in points or ()]
    if not xs or not ys:
        raise ValueError('hand_box needs at least one landmark')
    if width <= 0 or height <= 0:
        raise ValueError(f'hand_box needs a positive frame size, got {width}x{height}')

    left, right = min(xs) * width, max(xs) * width
    top, bottom = min(ys) * height, max(ys) * height
    centre_x, centre_y = (left + right) / 2.0, (top + bottom) / 2.0
    side = max(right - left, bottom - top) * (1.0 + 2.0 * max(0.0, margin))
    # One integer side for both axes: rounding each edge on its own yields a 1 px
    # difference, i.e. a crop that is not quite square (and a resize that distorts).
    size = max(1, int(round(side)))
    half = size / 2.0

    x0 = max(0, min(int(round(centre_x - half)), width - 1))
    y0 = max(0, min(int(round(centre_y - half)), height - 1))
    x1 = min(width, x0 + size)
    y1 = min(height, y0 + size)
    return x0, y0, max(x0 + 1, x1), max(y0 + 1, y1)


def _point_list(record) -> list:
    """The record's landmarks as `_Point`s, or `[]` when the shape is wrong."""
    points = record.get('landmarks') if isinstance(record, dict) else None
    if not isinstance(points, list) or len(points) != 21:
        return []
    shaped = []
    for point in points:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            return []
        try:
            shaped.append(_Point(float(point[0]), float(point[1])))
        except (TypeError, ValueError):
            return []
    return shaped


def valid(record) -> bool:
    """True when a record carries a label and 21 readable landmarks."""
    if not isinstance(record, dict):
        return False
    label = record.get('label')
    if not isinstance(label, str) or not label.strip():
        return False
    return bool(_point_list(record))


def read_records(path: str) -> list:
    """Every valid record of a JSONL file, in file order (`[]` when absent).

    A truncated or hand-edited line is skipped: a probe run over a partially written
    dataset must still report the samples that are there.
    """
    records = []
    try:
        handle = open(path, encoding='utf-8')
    except FileNotFoundError:
        return records
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if valid(record):
                records.append(record)
    return records


def record_line(record: dict) -> str:
    """One compact JSON line — the recorder's unit of storage."""
    return json.dumps(record, separators=(',', ':'), sort_keys=True)


def label_counts(records) -> dict:
    """`{label: count}`, most-sampled first (ties by name) — the dataset's shape."""
    counts = {}
    for record in records or ():
        label = str(record.get('label') or '').strip()
        if label:
            counts[label] = counts.get(label, 0) + 1
    return dict(sorted(counts.items(), key=lambda row: (-row[1], row[0])))


def hand_of(record) -> Hand | None:
    """The `Hand` a record describes, or None when its landmarks are unusable."""
    points = _point_list(record)
    if not points:
        return None
    return hand_from_landmarks(points)


def features(record) -> dict | None:
    """The geometry the rules read, measured on one record (None when unusable).

    These are the numbers the thresholds compare, so a probe prints them next to the
    threshold each one is checked against: `reach` against `EXTEND_RATIO`, `contact`
    against `CONTACT_RATIO`, `gaps` against `SPREAD_RATIO`, `direction` for the point
    family.
    """
    hand = hand_of(record)
    if hand is None:
        return None
    try:
        return {
            'reach': {finger: hand.reach(finger) for finger in FINGERS},
            'contact': hand.contact_ratio(),
            'gaps': [
                hand.tip_gap(LONG[i], LONG[i + 1]) for i in range(len(LONG) - 1)
            ],
            'spread': hand.spread(),
            'direction': hand.direction_name(INDEX_TIP),
            'extended': [finger for finger in FINGERS if hand.extended(finger)],
        }
    except (IndexError, TypeError, ValueError, ZeroDivisionError):
        return None


def percentiles(values, qs=(0.5,)) -> list:
    """Linear-interpolated percentiles of `values` (empty in, empty out).

    Deliberately not numpy: the dataset module has to stay importable in the feed's
    image and in a test run without the ML stack.
    """
    ordered = sorted(float(value) for value in values or ())
    if not ordered:
        return []
    result = []
    for q in qs:
        position = min(max(float(q), 0.0), 1.0) * (len(ordered) - 1)
        low = math.floor(position)
        high = min(low + 1, len(ordered) - 1)
        weight = position - low
        result.append(ordered[low] * (1 - weight) + ordered[high] * weight)
    return result


def _histogram(values) -> dict:
    counts = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items(), key=lambda row: (-row[1], str(row[0]))))


def motion_fires(records, tracker=None) -> list:
    """Replay a label's records through the motion tier, in time order.

    The ledger is written in time order and carries `at`, so a recorded sign can be
    replayed through `pipeline/gesture_motion.py` exactly as the feed would have seen it —
    which is the only way the swipe/wave/push thresholds can be calibrated on a real hand
    (`probe_gestures.py` prints the result per label).
    """
    from pipeline import gesture_motion

    tracker = tracker or gesture_motion.MotionTracker()
    ordered = sorted(
        (record for record in records or () if 'at' in record),
        key=lambda record: float(record['at']),
    )
    fires = []
    for record in ordered:
        hand = hand_of(record)
        if hand is None:
            continue
        fires.extend(tracker.update([hand], float(record['at'])))
    return fires


def summarize(records) -> dict:
    """Per label: how many samples, what the model and the rules said, and the geometry.

    `model` is the canned recognizer's top category per sample and `rules` what the
    geometric rules spelled — together they answer the question a probe exists for:
    *does this sign need a trained classifier, or does the model already name it?*
    `motion` is the trajectory replay (`motion_fires`), so a swipe is measured too.
    """
    grouped: dict = {}
    for record in records or ():
        label = str(record.get('label') or '').strip()
        if label:
            grouped.setdefault(label, []).append(record)

    summary = {}
    for label, bucket_records in grouped.items():
        bucket = {
            'count': 0,
            'model': [],
            'rules': [],
            'motion': _histogram(motion_fires(bucket_records)),
            'reach': {},
            'contact': [],
            'gaps': [],
            'direction': [],
            'extended': [],
        }
        for record in bucket_records:
            bucket['count'] += 1
            bucket['model'].append(str(record.get('top') or '').strip() or '-')
            bucket['rules'].extend(str(name) for name in record.get('rules') or ())
            measured = features(record)
            if measured is None:
                continue
            for finger, value in measured['reach'].items():
                bucket['reach'].setdefault(finger, []).append(value)
            bucket['contact'].append(measured['contact'])
            bucket['gaps'].extend(measured['gaps'])
            bucket['direction'].append(measured['direction'])
            bucket['extended'].append(len(measured['extended']))

        bucket['model'] = _histogram(bucket['model'])
        bucket['rules'] = _histogram(bucket['rules'])
        bucket['direction'] = _histogram(bucket['direction'])
        bucket['extended'] = _histogram(bucket['extended'])
        bucket['reach'] = {
            finger: percentiles(values, (0.0, 0.5, 1.0))
            for finger, values in bucket['reach'].items()
        }
        for key in ('contact', 'gaps'):
            bucket[key] = percentiles(bucket[key], (0.0, 0.5, 1.0))
        summary[label] = bucket
    return dict(sorted(summary.items(), key=lambda row: (-row[1]['count'], row[0])))
