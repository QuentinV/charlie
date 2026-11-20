"""The static rules: the poses the canned gesture model has no label for. Pure.

`classify(hand)` returns **one** name (or None) — an ordered, total partition, first
match wins. Two rules firing on the same frame would make `GestureVote` flicker between
two names for one sign, which is invisible in a log and infuriating in use; one ordered
table cannot do that, and the order is the specificity order (a contact pose before a
finger count, a closed thumb before an open one).

`None` means **the model's own label stands**: the rules deliberately do not shadow what
the bundle already names — a raised index is `Pointing_Up`, index+middle is `Victory`, a
vertical thumb is `Thumb_Up`/`Thumb_Down`. They add what it cannot say. The closed list
of publishable names is the table in `pipeline/gesture_vocab.py`; the thresholds are the
features in `pipeline/hands.py`.

Calibrated on recorded frames (`recorder.py` + `probe_gestures.py`): the predicates are
exact geometry, but *which* geometry a real hand makes is a measurement, not a guess.
"""
from pipeline.hands import FINGERS, INDEX_TIP, THUMB_TIP, WRIST

#: The four long fingers, in the counting order the digits family reads.
LONG = ('index', 'middle', 'ring', 'pinky')
#: How far the index has to reach out of the palm (÷ palm scale, wrist → tip ÷ wrist →
#: MCP) for a thumb-index touch to be a **pinch**. A fist's thumb tip passes within the
#: contact ratio of the index tip (measured ~0.3 palm scales), and without this guard a
#: closed fist — a pose the canned model names `Closed_Fist` — would be published as
#: `Pinch`. A real pinch's index reaches past its own knuckle (reach ≥ ~1.3); a curled
#: one comes back to mid-palm (~0.6). Calibrated on recorded frames.
CONTACT_REACH = 1.1


def _count(hand, fingers=LONG) -> int:
    """How many of `fingers` are extended."""
    return sum(1 for finger in fingers if hand.extended(finger))


def _is_horizontal(hand) -> bool:
    """A thumb held sideways rather than up/down (image axes, y down)."""
    dx = hand.point(THUMB_TIP)[0] - hand.point(WRIST)[0]
    dy = hand.point(THUMB_TIP)[1] - hand.point(WRIST)[1]
    return abs(dx) >= abs(dy)


def classify(hand) -> str | None:
    """The name this hand's geometry spells, or None when the model's label stands."""
    if hand is None:
        return None
    try:
        extended = {finger: hand.extended(finger) for finger in FINGERS}
    except (IndexError, TypeError):
        return None

    # 1. A contact is the most specific thing a hand can do with two fingers — and it
    #    also beats the canned `Closed_Fist`, which fires on a pinch. The index has to
    #    reach out of the palm for it to be a pinch (see `CONTACT_REACH`).
    if hand.contact() and hand.reach('index') >= CONTACT_REACH:
        return 'OK' if _count(hand, ('middle', 'ring', 'pinky')) >= 2 else 'Pinch'

    # 2. The two special hands: thumb+pinky (`Call_Me`) and index+pinky (`Rock`).
    if (
        extended['thumb']
        and extended['pinky']
        and _count(hand, ('index', 'middle', 'ring')) == 0
    ):
        return 'Call_Me'
    if (
        extended['index']
        and extended['pinky']
        and not extended['middle']
        and not extended['ring']
    ):
        return 'Rock'

    # 3. Only the thumb out: sideways is the new name, vertical is the model's
    #    (`Thumb_Up` / `Thumb_Down`) — None lets it publish.
    if extended['thumb'] and _count(hand) == 0:
        return 'Thumbs_Sideways' if _is_horizontal(hand) else None

    # 4. All four out: the thumb tells `Four` from `Five`, the spread tells `Stop`.
    if _count(hand) == 4:
        if not extended['thumb']:
            return 'Four'
        return 'Stop' if hand.spread() else 'Five'

    # 5. Three: index+middle+ring out, pinky curled (the thumb may be either).
    if (
        extended['index']
        and extended['middle']
        and extended['ring']
        and not extended['pinky']
    ):
        return 'Three'

    # 6. Index only: the direction names it, and "up" stays the model's `Pointing_Up`.
    if extended['index'] and _count(hand, ('middle', 'ring', 'pinky')) == 0:
        return {
            'left': 'Point_Left',
            'right': 'Point_Right',
            'down': 'Point_Down',
        }.get(hand.direction_name(INDEX_TIP))

    return None


def classify_all(hands) -> list:
    """`[(name, hand)]` for the hands whose geometry spells a name.

    Kept here (rather than in `gesture.py`) so the loop and its order — the *first*
    hand's name first, which is what the trace shows — are testable without mediapipe.
    """
    found = []
    for hand in hands or ():
        name = classify(hand)
        if name:
            found.append((name, hand))
    return found
