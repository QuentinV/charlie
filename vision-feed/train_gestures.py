"""Train the custom gesture classifier from the recorded dataset (G3).

BUILD TOOL, run in its own venv — see `requirements-train.txt`:

    python3.11 -m venv .venv-train
    .venv-train/bin/pip install -r requirements-train.txt
    .venv-train/bin/python train_gestures.py --dataset dataset --out models

Writes into `--out` (default `models/`, mounted into the feed):

    gesture_recognizer.task     a full bundle (canned + trained), written with
                                `--export-bundle` — **the route the feed loads**
                                (`VISION_GESTURE_MODEL`). Its label set replaces the canned
                                one, so the trained names are declared as `model` rows.
    gesture_labels.json         the label order the classifier was trained on.
    gesture_classifier.tflite   the classifier **alone**, kept for tooling only: the
                                mediapipe the feed ships (1.2.x) has no model path on
                                `ClassifierOptions`, so a second classifier cannot be
                                merged into the stock one — the feed skips this file with
                                a named note and the bundle above is how a trained label
                                ships (`pipeline/gesture.py`).

The vocabulary is the contract: every `custom` row of `gestures.json` should have a
dataset folder (a declared label with no samples can never be emitted) and every folder
should be declared (a label nobody declared is dropped by `hits_from_gestures`). Both are
*warnings*, because recording usually comes first — the script prints the rows to paste.

Model Maker's own rules, which this script cannot relax:

- the dataset must contain a **`none`** folder: its label set needs a negative class;
- it trains on the **images** (`dataset/<label>/*.jpg`, written by `recorder.py`) and
  detects the hand itself — which is why the recorder pads the crop;
- the trained classifier is tied to the **bundle version**: it consumes the gesture
  *embedding* of the MediaPipe build that produced it, so a new `gesture_recognizer.task`
  (a new `GESTURE_MODEL_URL`) means retraining.
"""
import argparse
import json
import os
import sys

import config


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description='Train the custom gesture classifier (Model Maker).'
    )
    parser.add_argument(
        '--dataset', default='dataset', help='recorded dataset (recorder.py)'
    )
    parser.add_argument('--out', default='models', help='where to write the artifacts')
    parser.add_argument('--epochs', type=int, default=20, help='training epochs')
    parser.add_argument('--batch', type=int, default=2, help='batch size')
    parser.add_argument(
        '--min-detection-confidence',
        type=float,
        default=0.5,
        help='hand-detection floor when the dataset is built (Model Maker: 0.7)',
    )
    parser.add_argument(
        '--export-bundle',
        action='store_true',
        help='also write the full .task bundle (for VISION_GESTURE_MODEL)',
    )
    return parser.parse_args(argv)


def dataset_labels(dataset_dir: str) -> list:
    """The label folders of a dataset, `none` first (Model Maker's own order)."""
    try:
        names = sorted(
            name
            for name in os.listdir(dataset_dir)
            if os.path.isdir(os.path.join(dataset_dir, name))
        )
    except OSError:
        return []
    none = [name for name in names if name.lower() == 'none']
    return none + [name for name in names if name not in none]


def check(dataset_dir: str) -> tuple:
    """`(errors, warnings)` for a dataset about to be trained on."""
    errors, warnings = [], []
    labels = dataset_labels(dataset_dir)
    if not labels:
        errors.append(
            f'no label folders under {os.path.abspath(dataset_dir)} — '
            'record something first (recorder.py)'
        )
        return errors, warnings
    if 'none' not in [name.lower() for name in labels]:
        errors.append(
            'no "none" folder — Model Maker rejects a dataset without a negative '
            'class (record a relaxed hand for a few seconds)'
        )
    declared = set(config.load_gestures().names_of('custom'))
    undeclared = [name for name in labels if name != 'none' and name not in declared]
    if undeclared:
        warnings.append(
            'not declared in gestures.json — their labels would be dropped by the '
            'feed: ' + ', '.join(undeclared)
        )
    unrecorded = sorted(declared - set(labels))
    if unrecorded:
        warnings.append(
            'declared but never recorded (can never be emitted): '
            + ', '.join(unrecorded)
        )
    return errors, warnings


def rows_for(labels) -> list:
    """The `gestures.json` rows to paste for the labels that have no row yet."""
    declared = set(config.load_gestures().names_of('custom'))
    return [
        f'  {{ "name": "{label}", "source": "custom" }},'
        for label in labels
        if label != 'none' and label not in declared
    ]


def train(args) -> int:
    """Build the dataset, train, evaluate, export — in Model Maker's own order."""
    try:
        from mediapipe_model_maker import gesture_recognizer
    except ImportError as error:  # noqa: PERF203 - one clear message, not a traceback
        print(
            f'mediapipe-model-maker is not installed in this interpreter ({error}).\n'
            'It needs Python 3.10/3.11 (TensorFlow <2.16 has no 3.12 wheels) — see\n'
            'requirements-train.txt:\n'
            '    python3.11 -m venv .venv-train\n'
            '    .venv-train/bin/pip install -r requirements-train.txt',
            file=sys.stderr,
        )
        return 1

    from pipeline import gesture_dataset

    labels = dataset_labels(args.dataset)
    counts = gesture_dataset.label_counts(
        gesture_dataset.read_records(os.path.join(args.dataset, 'landmarks.jsonl'))
    )
    print(
        f'training on {args.dataset}: '
        + ', '.join(f'{name} {counts.get(name, 0)}' for name in labels)
    )

    data = gesture_recognizer.Dataset.from_folder(
        dirname=args.dataset,
        hparams=gesture_recognizer.HandDataPreprocessingParams(
            min_detection_confidence=args.min_detection_confidence
        ),
    )
    train_data, rest = data.split(0.8)
    validation_data, test_data = rest.split(0.5)
    print(
        f'  {train_data.size} train / {validation_data.size} validation / '
        f'{test_data.size} test'
    )

    os.makedirs(args.out, exist_ok=True)
    hparams = gesture_recognizer.HParams(
        export_dir=args.out, epochs=args.epochs, batch_size=args.batch
    )
    options = gesture_recognizer.GestureRecognizerOptions(hparams=hparams)
    model = gesture_recognizer.GestureRecognizer.create(
        train_data, validation_data, options=options
    )
    loss, accuracy = model.evaluate(test_data)
    print(f'  held-out: loss {loss:.3f}, accuracy {accuracy:.3f}')
    print(
        '  a label whose recall is not near 1.0 needs more samples, not a lower '
        'threshold: `probe_gestures.py --replay` says which label it is'
    )

    labels_path = os.path.join(args.out, 'gesture_labels.json')
    with open(labels_path, 'w', encoding='utf-8') as handle:
        json.dump(list(data.label_names), handle, indent=4)
    print(f'  labels → {labels_path}')

    # The classifier *alone*. Kept because it is the artifact a future mediapipe could
    # merge in (it would need a model path on `ClassifierOptions`), but on the version the
    # feed ships it is **not** loadable: `pipeline/gesture.py` skips it with a named note
    # and the bundle below is the route that works. `_model`/`_label_names` are the two
    # private attributes Model Maker's own `export_model` reads, so they are as stable as
    # that path.
    classifier_path = os.path.join(args.out, 'gesture_classifier.tflite')
    try:
        import shutil

        from mediapipe.model_maker.python.core.utils import model_util

        buffer = model_util.convert_to_tflite(model._model)
        if isinstance(buffer, str):
            shutil.copyfile(buffer, classifier_path)
        else:
            with open(classifier_path, 'wb') as handle:
                handle.write(buffer)
        print(
            f'  classifier → {classifier_path}   (kept for tooling; the feed cannot '
            'merge a lone classifier — ship the bundle)'
        )
    except Exception as error:  # noqa: BLE001 - the bundle below still works
        print(f'  could not export the classifier alone ({error})')

    if args.export_bundle:
        model.export_model()
        print(
            f'  bundle → {os.path.join(args.out, "gesture_recognizer.task")}   '
            '(VISION_GESTURE_MODEL; its label set replaces the canned one)'
        )
    else:
        print(
            '  the feed loads the bundle, not the classifier alone: re-run with '
            '--export-bundle'
        )
    return 0


def main(argv=None) -> int:
    args = parse_args(argv)
    errors, warnings = check(args.dataset)
    for warning in warnings:
        print(f'warning: {warning}')
    if warnings:
        rows = rows_for(dataset_labels(args.dataset))
        if rows:
            print('declare them in gestures.json before the feed can publish them:')
            print('\n'.join(rows))
    if errors:
        for error in errors:
            print(f'error: {error}', file=sys.stderr)
        return 1
    return train(args)


if __name__ == '__main__':
    raise SystemExit(main())
