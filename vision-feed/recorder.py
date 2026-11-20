"""Record gesture samples — the dataset the rules are calibrated on, and trained on.

    # in the container (the camera, mediapipe and the baked model are there):
    docker compose exec vision-feed python recorder.py --label Stop --seconds 20

    # on the host, against the webcam helper or any stream:
    python recorder.py --label Stop --source-kind mjpeg --source http://127.0.0.1:9312/video.mjpg
    python recorder.py --label none --seconds 20      # a relaxed hand — required class
    python recorder.py --summary                      # what the dataset holds

One frame yields **two** artifacts, because the dataset answers two different questions
(`pipeline/gesture_dataset.py`):

    dataset/landmarks.jsonl          what the sign *measures* (the rules' thresholds)
    dataset/<label>/<stamp>_<n>.jpg  what the sign *looks like* (Model Maker trains on
                                     these crops — `train_gestures.py`)

`--label` is what **you** are performing, never what the model said: the model's own
answer is recorded beside it, so `probe_gestures.py` can report whether the canned model
already names the sign (in which case it needs no training at all).

Two rules the dataset cannot be repaired from later:

- **`none` is required.** The trained classifier's label set must contain a negative
  class, and Model Maker rejects a dataset without it — record a relaxed hand for a few
  seconds, plus a few other everyday poses.
- **A label needs a `custom` row in `gestures.json`** before the feed publishes it. This
  script warns when it is missing; declaring it later is one line.

The dataset is local (gitignored, never baked into the image) and it is a recording of
hands in your home — treat it like one.
"""
import argparse
import os
import sys
import time

import config

from pipeline import gesture_dataset
from pipeline.gesture import GestureDetector

#: What the crop is resized to. The classifier's hand detector wants the hand to fill a
#: good part of the frame; 320 is what MediaPipe's own gesture data is built around.
DEFAULT_SIZE = 320
#: The padding around the hand's landmarks, as a fraction of the box's own side.
DEFAULT_MARGIN = 0.35
#: The source kinds `pipeline.sources.source_for` understands.
SOURCE_KINDS = ('webcam', 'mjpeg', 'rtsp', 'ha')


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description='Record hand samples into a gesture dataset.'
    )
    parser.add_argument('--label', help='the sign being performed (e.g. Stop, none)')
    parser.add_argument(
        '--out', default='dataset', help='dataset directory (default: dataset)'
    )
    parser.add_argument(
        '--seconds', type=float, default=20.0, help='how long to record'
    )
    parser.add_argument(
        '--every',
        type=int,
        default=2,
        help='keep one frame out of N (consecutive frames are near-duplicates)',
    )
    parser.add_argument(
        '--size', type=int, default=DEFAULT_SIZE, help='crop side in pixels (0 = native)'
    )
    parser.add_argument(
        '--margin',
        type=float,
        default=DEFAULT_MARGIN,
        help='padding around the hand, as a fraction of the box side',
    )
    parser.add_argument(
        '--source-kind', default='webcam', choices=SOURCE_KINDS,
        help='how frames are read (default: the local camera)',
    )
    parser.add_argument(
        '--source-url',
        default='0',
        help='stream URL, or the device index for --source-kind webcam',
    )
    parser.add_argument(
        '--summary', action='store_true', help='print what the dataset holds and exit'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='recognize and print, write nothing (check the label is visible first)',
    )
    return parser.parse_args(argv)


def crops_per_label(out: str) -> dict:
    """`{label: jpg count}` — what the trainer will actually see on disk."""
    counts = {}
    try:
        names = sorted(os.listdir(out))
    except OSError:
        return counts
    for name in names:
        folder = os.path.join(out, name)
        if not os.path.isdir(folder):
            continue
        counts[name] = sum(
            1 for entry in os.listdir(folder) if entry.lower().endswith('.jpg')
        )
    return counts


def summary(out: str) -> None:
    """Print the dataset's shape: samples per label, crops per label, what is missing."""
    counts = gesture_dataset.label_counts(
        gesture_dataset.read_records(os.path.join(out, 'landmarks.jsonl'))
    )
    folders = crops_per_label(out)
    print(f'dataset {os.path.abspath(out)}')
    if not counts and not folders:
        print('  empty — record something first (--label Stop --seconds 20)')
        return
    for label in sorted(set(counts) | set(folders)):
        print(
            f'  {label:<12} {counts.get(label, 0):>5} samples '
            f'{folders.get(label, 0):>5} crops'
        )
    declared = set(config.load_gestures().names_of('custom'))
    missing = [label for label in folders if label != 'none' and label not in declared]
    if missing:
        print('not declared in gestures.json (source "custom"): ' + ', '.join(missing))
    if 'none' not in folders:
        print('no "none" samples — the trained classifier needs a negative class')


def save_crop(frame, hand, args, stamp: str, index: int) -> str:
    """Write the padded crop of one hand; returns its path ('' when it failed)."""
    import cv2

    height, width = frame.shape[:2]
    x0, y0, x1, y1 = gesture_dataset.hand_box(
        hand.points, width, height, args.margin
    )
    crop = frame[y0:y1, x0:x1]
    if crop.size == 0:
        return ''
    if args.size:
        crop = cv2.resize(
            crop, (args.size, args.size), interpolation=cv2.INTER_AREA
        )
    path = os.path.join(args.out, args.label, f'{stamp}_{index}.jpg')
    if not cv2.imwrite(path, crop, [int(cv2.IMWRITE_JPEG_QUALITY), 90]):
        return ''
    return path


def record(args, detector, source) -> int:
    """The recording loop: one recognizer call per frame, two artifacts per kept frame."""
    label = (args.label or '').strip()
    os.makedirs(os.path.join(args.out, label), exist_ok=True)
    started = time.monotonic()
    seen = kept = 0
    every = max(1, args.every)

    with open(
        os.path.join(args.out, 'landmarks.jsonl'), 'a', encoding='utf-8'
    ) as ledger:
        while time.monotonic() - started < args.seconds:
            frame = source.read()
            if frame is None:
                time.sleep(0.05)
                continue
            seen += 1
            detector.detect(frame)
            hands = detector.last_hands
            if not hands or seen % every:
                continue
            # The nearest hand: one hand per sample keeps the crop unambiguous (a second
            # hand in the frame would land in the same crop).
            hand = max(hands, key=lambda item: item.palm_scale)
            answer = detector.last or {}
            height, width = frame.shape[:2]
            stamp = time.strftime('%Y%m%d-%H%M%S', time.localtime())
            path = (
                save_crop(frame, hand, args, stamp, kept)
                if not args.dry_run
                else ''
            )
            record = {
                'label': label,
                'at': round(time.time(), 3),
                'file': os.path.relpath(path, args.out) if path else '',
                'top': answer.get('top', ''),
                'score': answer.get('score', 0.0),
                'rules': list(answer.get('rules') or ()),
                'handedness': hand.handedness,
                'handednessScore': round(hand.score, 3),
                'landmarks': [
                    [round(float(value), 5) for value in point]
                    for point in hand.points
                ],
                'world': (
                    [
                        [round(float(value), 5) for value in point]
                        for point in hand.world
                    ]
                    if hand.world
                    else None
                ),
                'palmScale': round(hand.palm_scale, 5),
                'frame': [width, height],
            }
            if not args.dry_run:
                ledger.write(gesture_dataset.record_line(record) + '\n')
                ledger.flush()
            kept += 1
            if kept % 10 == 0 or args.dry_run:
                print(
                    f'  {kept} kept ({seen} frames) — model '
                    f'{record["top"] or "-"} {record["score"]:.2f}, '
                    f'rules {",".join(record["rules"]) or "-"}'
                )
    return kept


def main(argv=None) -> int:
    args = parse_args(argv)
    if args.summary:
        summary(args.out)
        return 0
    if not args.label or not args.label.strip():
        print('--label is required (e.g. --label Stop, --label none)', file=sys.stderr)
        return 2

    detector = GestureDetector()
    reason = detector.unavailable_reason()
    if reason is not None:
        print(f'cannot record: {reason}', file=sys.stderr)
        return 1

    label = args.label.strip()
    table = config.resolve_gesture_table() or 'the built-in table'
    try:
        declared = config.load_gestures().owns(label)
    except ValueError as error:
        # Recording is exactly what a broken table needs (the labels have to come from
        # somewhere), so warn and carry on instead of refusing.
        declared = True
        print(
            f'note: {table} does not validate ({error}) — the feed refuses to run '
            'gestures until it does'
        )
    if label != 'none' and not declared:
        print(
            f'note: "{label}" is not declared in {table} — add '
            f'{{"name": "{label}", "source": "custom"}} before the feed publishes it'
        )

    from pipeline import sources

    source = sources.source_for({'kind': args.source_kind, 'url': args.source_url})
    source.open()
    print(
        f'recording "{label}" for {args.seconds:g}s from {args.source_kind} '
        f'({args.source_url}) into {os.path.abspath(args.out)}'
        + (' — dry run, nothing is written' if args.dry_run else '')
    )
    try:
        kept = record(args, detector, source)
    except KeyboardInterrupt:
        print('\nstopped')
        kept = 0
    finally:
        source.close()
    print(f'{kept} samples recorded')
    if kept and not args.dry_run:
        summary(args.out)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
