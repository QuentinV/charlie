"""The gesture vocabulary — the closed set of names a `gesture` event may carry.

Every name Charlie may publish is declared here, and each name is owned by exactly one
**source**:

- ``model``  — a category of the recognizer's *canned* classifier (the shipped
  ``gesture_recognizer.task``: ``Closed_Fist``, ``Open_Palm``, …). Its label map is
  fixed and no option adds a class to it.
- ``custom`` — a category of the **trained** classifier (``train_gestures.py``), shipped
  as a **bundle** (``--export-bundle`` → ``VISION_GESTURE_MODEL``): the mediapipe we ship
  takes no model path for a second classifier, so a lone ``.tflite`` is skipped.
- ``rules``  — a geometric predicate over the 21 hand landmarks
  (``pipeline/gesture_rules.py``): the poses the canned model has no label for.
- ``motion`` — a trajectory of those same landmarks over a short window
  (``pipeline/gesture_motion.py``): the signs a single frame cannot express.

The source is not bookkeeping, it is what keeps the vocabulary **closed**: the enabled
``model`` names are handed to the recognizer as its ``category_allowlist`` (mediapipe's
own name for it), so a label a future
bundle adds cannot reach the bus unannounced, and a name no row owns is dropped on the
way out (``hits_from_gestures(..., allowed=…)``).

The table ships as ``gestures.json`` (mounted: the vocabulary is editable without
rebuilding the image) and the identical rows are the built-in ``DEFAULT_VOCABULARY``,
so a feed with no file runs the shipped vocabulary instead of no gestures at all. A
test asserts the two are the same — they cannot drift.

``score`` is one number per name, read by whichever source owns it: for ``rules`` it is
the score a matched predicate *reports*, for ``model``/``custom`` it is a **floor
override** on the recognizer's probability (a trained label usually needs a higher one
than a canned category). The two are not comparable quantities — the number only orders
one frame's vote (``GestureVote``), which is the only thing it is used for.

Pure stdlib, no ``config`` import: the defaults a caller may want to override (the
global floor, the rule score) are passed in, so this module stays testable on its own.
"""
import json
from dataclasses import dataclass

#: The four producers of a name, in the table's order.
SOURCES = ('model', 'custom', 'rules', 'motion')


@dataclass(frozen=True)
class GestureName:
    """One vocabulary row: who owns the name, whether it is live, and its score."""

    name: str
    source: str
    enabled: bool = True
    #: ``None`` = the caller's default (the global floor / the rule score).
    score: float | None = None


@dataclass(frozen=True)
class Vocabulary:
    """The closed set of names, with the lookups the pipeline needs."""

    names: tuple

    @property
    def by_name(self) -> dict:
        return {row.name: row for row in self.names}

    def row(self, name: str) -> GestureName | None:
        return self.by_name.get(name)

    def owns(self, name: str) -> bool:
        """True when the table declares the name (enabled or not)."""
        return name in self.by_name

    def is_enabled(self, name: str) -> bool:
        row = self.by_name.get(name)
        return bool(row and row.enabled)

    def names_of(self, source: str, enabled_only: bool = True) -> tuple:
        return tuple(
            row.name
            for row in self.names
            if row.source == source and (row.enabled or not enabled_only)
        )

    def score_for(self, name: str, default: float) -> float:
        """The name's own ``score``, else the caller's default."""
        row = self.by_name.get(name)
        if row is None or row.score is None:
            return default
        return row.score

    def model_allow_list(self) -> list:
        """The enabled ``model`` names — the canned classifier's ``allow_list``."""
        return list(self.names_of('model'))

    def custom_allow_list(self) -> list:
        return list(self.names_of('custom'))

    def custom_score_threshold(self, default: float) -> float:
        """The lowest floor among the enabled ``custom`` rows (else the default).

        One threshold for the whole trained classifier (the option is per-classifier,
        not per-label): the *lowest* row's floor, so no trained label is silently
        unreachable — and the vote, not the threshold, does the deciding, the same
        reasoning as the global floor.
        """
        floors = [
            self.score_for(row.name, default)
            for row in self.names
            if row.source == 'custom' and row.enabled
        ]
        return min(floors) if floors else default


def parse_vocabulary(data) -> Vocabulary:
    """Validate a table (``{"names": [...]}`` or a bare list) into a `Vocabulary`.

    Raises ``ValueError`` naming the **row** and the offending value: a vocabulary is a
    contract, and "row 4 ('Stop') has source 'ruels'" is the difference between a
    two-second fix and a camera that silently publishes nothing.
    """
    rows = data.get('names') if isinstance(data, dict) else data
    if not isinstance(rows, list) or not rows:
        raise ValueError('expected {"names": [ … ]} with at least one row')

    seen: dict = {}
    parsed: list = []
    for index, raw in enumerate(rows):
        if not isinstance(raw, dict):
            raise ValueError(f'row {index} is not an object')
        name = raw.get('name')
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f'row {index} has no name')
        name = name.strip()
        source = raw.get('source')
        if source not in SOURCES:
            raise ValueError(
                f"row {index} ('{name}') has source {source!r} — expected one of "
                + ', '.join(SOURCES)
            )
        score = raw.get('score')
        if score is not None:
            try:
                score = float(score)
            except (TypeError, ValueError):
                raise ValueError(
                    f"row {index} ('{name}') has score {raw.get('score')!r} — "
                    'expected a number'
                )
            if not 0.0 <= score <= 1.0:
                raise ValueError(
                    f"row {index} ('{name}') has score {score} — expected 0..1"
                )
        if name in seen:
            raise ValueError(
                f"row {index} ('{name}') repeats row {seen[name]} — a name has one owner"
            )
        seen[name] = index
        parsed.append(
            GestureName(name, source, bool(raw.get('enabled', True)), score)
        )
    return Vocabulary(tuple(parsed))


#: The shipped vocabulary — the same rows as ``gestures.json`` (a test pins that).
#:
#: The canned seven are all kept: an automation may already match them, and the rules
#: below deliberately avoid the poses the model already names (an index raised up is
#: `Pointing_Up`, index+middle is `Victory` — a rule for either would only rename what
#: the model already does well). What the rules *add* is what the bundle cannot say:
#: the spread vs closed five, three, four, the lateral/down point, the pinch family,
#: `Rock` and `Call_Me`. `ILoveYou` ships **disabled** — it is the one canned category
#: that fires on a relaxed hand often enough to be noise, and re-enabling it is one row.
DEFAULT_ROWS = (
    {'name': 'Closed_Fist', 'source': 'model'},
    {'name': 'Open_Palm', 'source': 'model'},
    {'name': 'Pointing_Up', 'source': 'model'},
    {'name': 'Thumb_Down', 'source': 'model'},
    {'name': 'Thumb_Up', 'source': 'model'},
    {'name': 'Victory', 'source': 'model'},
    {'name': 'ILoveYou', 'source': 'model', 'enabled': False},
    {'name': 'Stop', 'source': 'rules'},
    {'name': 'Five', 'source': 'rules'},
    {'name': 'Four', 'source': 'rules'},
    {'name': 'Three', 'source': 'rules'},
    {'name': 'OK', 'source': 'rules'},
    {'name': 'Pinch', 'source': 'rules'},
    {'name': 'Point_Left', 'source': 'rules'},
    {'name': 'Point_Right', 'source': 'rules'},
    {'name': 'Point_Down', 'source': 'rules'},
    {'name': 'Thumbs_Sideways', 'source': 'rules'},
    {'name': 'Rock', 'source': 'rules'},
    {'name': 'Call_Me', 'source': 'rules'},
    {'name': 'Swipe_Left', 'source': 'motion'},
    {'name': 'Swipe_Right', 'source': 'motion'},
    {'name': 'Swipe_Up', 'source': 'motion'},
    {'name': 'Swipe_Down', 'source': 'motion'},
    {'name': 'Wave', 'source': 'motion'},
    {'name': 'Push', 'source': 'motion'},
    {'name': 'Pull', 'source': 'motion'},
)

DEFAULT_VOCABULARY = parse_vocabulary({'names': list(DEFAULT_ROWS)})


def load(path: str) -> Vocabulary:
    """Read and validate a table file (``ValueError`` from `parse_vocabulary`)."""
    with open(path, encoding='utf-8') as handle:
        return parse_vocabulary(json.load(handle))
