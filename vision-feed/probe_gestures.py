"""Probe a recorded gesture dataset — what the signs measure, what the model calls them.

    python probe_gestures.py                    # the per-label report
    python probe_gestures.py --label Stop       # one label
    python probe_gestures.py --replay           # also run the recognizer over the crops

Two questions, both answered from the same dataset (`recorder.py` writes it):

- **Does the sign measure what the rules assume?** Every threshold in `hands.py` is
  printed next to the range it was measured over, per label, so recalibrating one is a
  measurement (`reach ≥ 1.5` for an extended finger, `contact ≤ 0.40` for a pinch,
  `gaps ≥ 0.45` for a spread hand).
- **Does the canned model already name the sign?** `--replay` runs the recognizer in
  **image** mode over the saved crops — offline, no camera — and reports the top category
  per label. A label the model already calls by name needs no trained classifier at all;
  a label it calls `None` does. `no-hand` counts the crops the detector could not find a
  hand in: a tight crop (raise `--margin` in the recorder) is the classic reason a dataset
  trains and the model then sees nothing.

`--replay` needs mediapipe (the container has it); the report does not.
"""
import argparse
import os

import config

from pipeline import gesture_dataset


def thresholds() -> dict:
    """The thresholds the report annotates, read from the modules that own them."""
    from pipeline import gesture_motion
    from pipeline.gesture_rules import CONTACT_REACH
    from pipeline.hands import (
        CONTACT_RATIO,
        EXTEND_RATIO,
        SPREAD_RATIO,
        THUMB_EXTEND_RATIO,
    )

    return {
        'reach': EXTEND_RATIO,
        'thumb': THUMB_EXTEND_RATIO,
        'contact': CONTACT_RATIO,
        'reach_min': CONTACT_REACH,
        'gaps': SPREAD_RATIO,
        'straight': gesture_motion.MIN_STRAIGHT,
        'depth': gesture_motion.DEPTH_RATIO,
    }


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description='Report what a recorded gesture dataset says.'
    )
    parser.add_argument(
        '--out', default='dataset', help='dataset directory (default: dataset)'
    )
    parser.add_argument('--label', help='report a single label')
    parser.add_argument(
        '--replay',
        action='store_true',
        help='also run the recognizer over the saved crops (needs mediapipe)',
    )
    return parser.parse_args(argv)


def _range(values) -> str:
    """`min–p50–max` of a measured series."""
    low, middle, high = gesture_dataset.percentiles(values, (0.0, 0.5, 1.0))
    return f'{low:.2f}–{middle:.2f}–{high:.2f}'


def _histogram_text(counts: dict, total: int, limit: int = 4) -> str:
    if not counts:
        return '-'
    return ', '.join(
        f'{name} {count} ({100 * count / max(1, total):.0f}%)'
        for name, count in list(counts.items())[:limit]
    )


def report(records, label=None) -> list:
    """The per-label lines: samples, what the model/rules said, and the geometry."""
    limits = thresholds()
    lines = []
    for name, bucket in gesture_dataset.summarize(records).items():
        if label and name != label:
            continue
        total = bucket['count']
        lines.append(f'{name} — {total} samples')
        lines.append(f'  model    {_histogram_text(bucket["model"], total)}')
        lines.append(f'  rules    {_histogram_text(bucket["rules"], total)}')
        lines.append(
            f'  fingers  {_histogram_text(bucket["extended"], total)}'
            f'   direction {_histogram_text(bucket["direction"], total)}'
        )
        if bucket['motion']:
            lines.append(
                f'  motion   {_histogram_text(bucket["motion"], total)}'
                f'   (travel ≥ {config.GESTURE_MOTION_MIN_TRAVEL:g} palm scales, '
                f'straightness ≥ {limits["straight"]:g}, '
                f'depth ±{limits["depth"]:.0%})'
            )
        for finger in ('index', 'middle', 'ring', 'pinky', 'thumb'):
            values = bucket['reach'].get(finger)
            if not values:
                continue
            floor = limits['thumb'] if finger == 'thumb' else limits['reach']
            lines.append(
                f'  reach {finger:<7} {_range(values)}   ≥ {floor:g} is extended'
            )
        if bucket['contact']:
            lines.append(
                f'  contact  {_range(bucket["contact"])}   ≤ {limits["contact"]:g} is '
                f'a contact (the index must also reach ≥ {limits["reach_min"]:g})'
            )
        if bucket['gaps']:
            lines.append(
                f'  gaps     {_range(bucket["gaps"])}   ≥ {limits["gaps"]:g} is a spread '
                'hand (Stop rather than Five)'
            )
        lines.append('')
    return lines


def replay(records, out: str) -> list:
    """Run the recognizer over the saved crops (image mode) — the model's own answer.

    Offline on purpose: it is the same bundle the feed loads, over the *same* frames, so
    the numbers say whether a label needs training rather than whether a camera was
    pointed well.
    """
    import mediapipe as mp

    from pipeline.gesture import GestureDetector

    detector = GestureDetector()
    reason = detector.unavailable_reason()
    if reason is not None:
        return [f'replay unavailable: {reason}', '']

    by_label: dict = {}
    for record in records:
        relative = record.get('file') or ''
        path = os.path.join(out, relative)
        if relative and os.path.exists(path):
            by_label.setdefault(record['label'], []).append(path)
    if not by_label:
        return ['no crops on disk to replay (was the recorder run with --dry-run?)', '']

    lines = ['the recognizer, over the saved crops (image mode):']
    options = mp.tasks.vision.GestureRecognizerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=detector.model_path),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
    )
    with mp.tasks.vision.GestureRecognizer.create_from_options(options) as recognizer:
        for label, paths in sorted(by_label.items()):
            counts: dict = {}
            for path in paths:
                try:
                    result = recognizer.recognize(mp.Image.create_from_file(path))
                except Exception as error:  # noqa: BLE001 - one bad crop, not a run
                    key = f'error: {error}'
                else:
                    categories = getattr(result, 'gestures', None) or []
                    top = categories[0][0].category_name if categories and categories[0] else ''
                    key = (top or '').strip() or 'no-hand'
                counts[key] = counts.get(key, 0) + 1
            lines.append(f'  {label:<12} {_histogram_text(counts, len(paths), 6)}')
    lines.append('')
    return lines


def main(argv=None) -> int:
    args = parse_args(argv)
    records = gesture_dataset.read_records(
        os.path.join(args.out, 'landmarks.jsonl')
    )
    print(
        f'dataset {os.path.abspath(args.out)} — {len(records)} samples, '
        f'{len(gesture_dataset.label_counts(records))} labels'
    )
    print('')
    if not records:
        print('nothing to report — record something first (recorder.py)')
        return 1
    for line in report(records, args.label):
        print(line)
    if args.replay:
        for line in replay(records, args.out):
            print(line)
    print(
        "calibration: move a threshold in pipeline/hands.py when a label's range sits "
        'on it; train a classifier (train_gestures.py) for the labels the model calls '
        'None.'
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
