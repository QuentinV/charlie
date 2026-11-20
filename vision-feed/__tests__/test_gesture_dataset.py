"""The dataset module — the geometry and the summary the recorder and probe rely on.

These are the parts of the recording path that can be wrong *silently*: a crop that clips
the hand (the trainer learns an edge-of-frame hand, and the detector then finds nothing in
it), a record that does not validate (a probe that crashes mid-run instead of reporting),
and a summary whose numbers disagree with the thresholds they are printed beside. The
scripts themselves (`recorder.py`, `probe_gestures.py`) are thin: mediapipe, cv2, files.
"""
import json

import pytest

from helpers import make_hand
from pipeline import gesture_dataset as dataset

LONG = ('index', 'middle', 'ring', 'pinky')


def record_of(label, hand, **extra):
    """A ledger record for a synthetic hand (the recorder's own shape, minus I/O)."""
    return {
        'label': label,
        'landmarks': [[x, y, z] for x, y, z in hand.points],
        **extra,
    }


def write_ledger(tmp_path, lines):
    path = tmp_path / 'landmarks.jsonl'
    path.write_text('\n'.join(lines), encoding='utf-8')
    return str(path)


# --- the crop -----------------------------------------------------------------


def test_the_crop_is_square_padded_and_inside_the_frame():
    hand = make_hand(extended=LONG, thumb='up', spread=True)
    x0, y0, x1, y1 = dataset.hand_box(hand.points, 4000, 3000, 0.35)
    assert x1 - x0 == y1 - y0  # square: the detector wants palm context both ways
    assert 0 < x0 < x1 < 4000 and 0 < y0 < y1 < 3000
    # The hand's own box is a minority of the crop (the padding is real).
    xs = [point[0] * 4000 for point in hand.points]
    ys = [point[1] * 3000 for point in hand.points]
    assert (max(xs) - min(xs)) < (x1 - x0)
    assert (max(ys) - min(ys)) < (y1 - y0)


def test_a_hand_at_the_corner_is_clamped_not_clipped_away():
    hand = make_hand(wrist=(0.02, 0.02))
    x0, y0, x1, y1 = dataset.hand_box(hand.points, 640, 480, 0.35)
    assert (x0, y0) == (0, 0)
    assert x1 > x0 and y1 > y0
    assert x1 <= 640 and y1 <= 480


def test_a_degenerate_crop_is_still_a_usable_box():
    # One landmark (or 21 on the same pixel) must not produce an empty slice: a 1x1 crop
    # is obvious, a black image in the dataset is not.
    x0, y0, x1, y1 = dataset.hand_box([(0.5, 0.5)], 100, 100, 0.0)
    assert x1 > x0 and y1 > y0


def test_the_crop_refuses_nonsense():
    with pytest.raises(ValueError):
        dataset.hand_box([], 100, 100)
    with pytest.raises(ValueError):
        dataset.hand_box([(0.5, 0.5)], 0, 100)


# --- the ledger ---------------------------------------------------------------


def test_a_record_needs_a_label_and_21_readable_landmarks():
    hand = make_hand()
    assert dataset.valid(record_of('Stop', hand)) is True
    assert dataset.valid(record_of('', hand)) is False
    assert dataset.valid({'label': 'Stop'}) is False
    assert dataset.valid('nonsense') is False
    short = record_of('Stop', hand)
    short['landmarks'] = short['landmarks'][:20]
    assert dataset.valid(short) is False
    broken = record_of('Stop', hand)
    broken['landmarks'][0] = ['not', 'numbers']
    assert dataset.valid(broken) is False


def test_a_broken_line_is_skipped_not_fatal(tmp_path):
    """A half-written line is what a Ctrl-C during a recording looks like.

    The probe must still report the samples that made it to disk.
    """
    good = dataset.record_line(record_of('Stop', make_hand()))
    path = write_ledger(
        tmp_path,
        [good, '{"label": "Stop", "landmarks": [[0.1', '', 'not json', good],
    )
    records = dataset.read_records(path)
    assert len(records) == 2
    assert dataset.read_records(str(tmp_path / 'missing.jsonl')) == []


def test_a_record_line_round_trips(tmp_path):
    record = record_of('Wave', make_hand(), top='Open_Palm', rules=['Wave'])
    path = write_ledger(tmp_path, [dataset.record_line(record)])
    assert dataset.read_records(path)[0] == json.loads(json.dumps(record))


def test_the_labels_are_counted_most_sampled_first():
    records = [
        record_of('Stop', make_hand()),
        record_of('Wave', make_hand()),
        record_of('Stop', make_hand()),
        record_of('none', make_hand()),
    ]
    assert list(dataset.label_counts(records)) == ['Stop', 'Wave', 'none']
    assert dataset.label_counts(records)['Stop'] == 2
    assert dataset.label_counts([]) == {}


# --- the measurements ---------------------------------------------------------


def test_the_features_are_the_numbers_the_thresholds_compare():
    open_hand = dataset.features(
        record_of('Stop', make_hand(extended=LONG, thumb='up', spread=True))
    )
    assert set(open_hand['extended']) == {'thumb', 'index', 'middle', 'ring', 'pinky'}
    assert open_hand['spread'] is True
    assert open_hand['reach']['index'] > 1.5  # EXTEND_RATIO
    assert min(open_hand['gaps']) >= 0.45  # SPREAD_RATIO

    pinch = dataset.features(
        record_of('Pinch', make_hand(extended=('index',), thumb='contact'))
    )
    assert pinch['contact'] <= 0.40  # CONTACT_RATIO
    # The thumb is *out* in a pinch (its tip is on the index tip, far from the wrist),
    # which is why the contact rule is evaluated before any finger count.
    assert 'index' in pinch['extended']

    relaxed = dataset.features(record_of('none', make_hand()))
    assert relaxed['extended'] == []
    assert dataset.features({'label': 'x'}) is None


def test_percentiles_interpolate_and_survive_an_empty_series():
    assert dataset.percentiles([], (0.5,)) == []
    assert dataset.percentiles([1, 2, 3, 4], (0.0, 0.5, 1.0)) == [1.0, 2.5, 4.0]
    assert dataset.percentiles([5], (0.5,)) == [5.0]


def test_the_summary_reports_what_the_model_and_the_rules_said():
    open_hand = make_hand(extended=LONG, thumb='up', spread=True)
    records = [
        record_of('Stop', open_hand, top='Open_Palm', rules=['Stop']),
        record_of('Stop', open_hand, top='None', rules=['Stop']),
        record_of('Pinch', make_hand(extended=('index',), thumb='contact'),
                  top='None', rules=['Pinch']),
    ]
    summary = dataset.summarize(records)
    assert list(summary) == ['Stop', 'Pinch']  # most sampled first
    assert summary['Stop']['count'] == 2
    assert summary['Stop']['model'] == {'Open_Palm': 1, 'None': 1}
    assert summary['Stop']['rules'] == {'Stop': 2}
    assert summary['Stop']['extended'] == {5: 2}
    # The range the threshold is printed next to (`reach index ≥ 1.5`).
    low, middle, high = summary['Stop']['reach']['index']
    assert low == middle == high  # two identical synthetic hands
    assert low > 1.5
    assert summary['Pinch']['contact'][1] <= 0.40
    assert dataset.summarize([]) == {}


def test_a_degenerate_hand_does_not_break_the_summary():
    # 21 landmarks on one pixel is what a half-tracked hand looks like: the sample is
    # still recorded, and the summary must produce numbers instead of a division error.
    records = [{'label': 'Stop', 'landmarks': [[0.1, 0.1]] * 21, 'top': 'Open_Palm'}]
    summary = dataset.summarize(records)
    assert summary['Stop']['count'] == 1
    assert summary['Stop']['reach']['index'] == [0.0, 0.0, 0.0]


# --- the motion replay --------------------------------------------------------


def test_a_recorded_swipe_replays_through_the_motion_tier():
    """The ledger is time-ordered and carries `at`: a sign replays as the feed saw it.

    This is the only way the swipe/wave/push thresholds can be calibrated on a real hand
    rather than on a synthetic one.
    """
    records = [
        dict(record_of('Swipe_Right', make_hand(wrist=(x, 0.60))), at=index * 0.1)
        for index, x in enumerate((0.30, 0.35, 0.40, 0.45, 0.50))
    ]
    assert dataset.motion_fires(records) == ['Swipe_Right']
    assert dataset.summarize(records)['Swipe_Right']['motion'] == {'Swipe_Right': 1}


def test_a_still_hand_replays_as_no_motion():
    # Six samples of a hand that does not move: no swipe, no wave, no push.
    records = [
        dict(record_of('none', make_hand()), at=index * 0.1) for index in range(6)
    ]
    assert dataset.motion_fires(records) == []
    assert dataset.summarize(records)['none']['motion'] == {}


def test_the_replay_reads_the_clock_not_the_file_order():
    # A ledger appended by two sessions is not in time order; the replay sorts by `at`,
    # because a swipe replayed out of order is not a swipe at all (this file order jumps
    # 0.50 → 0.30 on its second line, which no hand did).
    shuffled = [
        dict(record_of('Swipe_Left', make_hand(wrist=(x, 0.60))), at=at)
        for x, at in ((0.50, 0.0), (0.30, 0.4), (0.45, 0.1), (0.35, 0.3), (0.40, 0.2))
    ]
    assert [record['at'] for record in shuffled] != sorted(
        record['at'] for record in shuffled
    )
    assert dataset.motion_fires(shuffled) == ['Swipe_Left']
