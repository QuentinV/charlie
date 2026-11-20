"""Synthetic hands for the gesture tests — no mediapipe, no model, no I/O.

Proportions are the real ones, in **palm scales**: the palm is 0.10 of the frame, a
straight finger reaches ~0.18 beyond its knuckle, a curled one comes back to mid-palm.
The thresholds in `pipeline/hands.py` are stated in those units, so a test that builds a
"straight finger" asserts exactly what the constant promises — and a change that breaks a
real hand shape fails here rather than on a camera.

`make_hand` is a *description* of a pose, not a recording: it is what the rules are
tested against, while a real sign is validated by `probe_gestures.py` over recorded
clips (the two are complementary: one pins the geometry, the other the hand).
"""
import math

from pipeline.hands import INDEX_TIP, THUMB_TIP, Hand

#: The wrist, and the palm scale a default hand has (0.10 of the frame).
WRIST = (0.50, 0.80)
PALM = 0.10
#: The knuckles, in image coordinates (x right, y down).
MCPS = {
    'index': (0.47, 0.70),
    'middle': (0.50, 0.70),
    'ring': (0.53, 0.70),
    'pinky': (0.56, 0.70),
    'thumb': (0.43, 0.78),
}
#: Where a straight finger points by default (up, in image coordinates).
UP = (0.0, -1.0)
#: The angle each long finger takes when the hand is **spread** (a stop sign).
SPREAD_ANGLE = {'index': -25.0, 'middle': -8.0, 'ring': 8.0, 'pinky': 25.0}
#: A straight finger's reach past its knuckle, and a curled one's (back towards the palm).
EXTENDED_LENGTH = 0.18
CURLED_LENGTH = 0.05
#: Where a **tucked** thumb's tip sits (across the palm, inside the contact ratio of the
#: index tip — the fist case `CONTACT_REACH` exists for).
TUCKED_THUMB = (0.47, 0.75)
#: The thumb's own direction when it is out: vertical (up) or sideways (left).
THUMB_UP = (0.0, -1.0)
THUMB_SIDE = (-1.0, 0.05)


def _rotate(direction, degrees):
    angle = math.radians(degrees)
    x, y = direction
    return (
        x * math.cos(angle) - y * math.sin(angle),
        x * math.sin(angle) + y * math.cos(angle),
    )


def _chain(mcp, direction, length):
    """The four landmarks of one finger (MCP, PIP, DIP, tip) along `direction`."""
    x, y = mcp
    dx, dy = direction
    return [
        (x + dx * length * f, y + dy * length * f, 0.0)
        for f in (0.0, 0.55, 0.85, 1.0)
    ]


def make_hand(
    extended=(),
    thumb='tucked',
    direction=UP,
    spread=False,
    wrist=WRIST,
    scale=1.0,
) -> Hand:
    """A synthetic 21-landmark hand.

    `extended` lists the long fingers that are straight; `thumb` is `'tucked'` (curled
    across the palm), `'up'`, `'side'` or `'contact'` (its tip on the index tip — the
    pinch/OK case); `spread` opens the four fingers apart; `direction` is where the hand
    *points*, and the whole hand rotates with it (a hand pointing down has its knuckles
    below the wrist — rotating only the fingers would make a "curled" finger measure as
    extended); `scale` grows the hand about the wrist (the depth cue the motion tier
    reads).
    """
    points = _canonical(extended, thumb, spread, wrist)
    angle = math.degrees(math.atan2(direction[0], -direction[1]))
    if angle or scale != 1.0:
        points = [_transform(point, wrist, angle, scale) for point in points]
    return Hand(tuple(points), 'Right', 0.99)


def _transform(point, wrist, angle, scale):
    """Rotate about the wrist by `angle` (image axes, y down), then scale about it."""
    x, y, z = point
    dx, dy = (x - wrist[0]) * scale, (y - wrist[1]) * scale
    if angle:
        dx, dy = _rotate((dx, dy), angle)
    return (wrist[0] + dx, wrist[1] + dy, z * scale)


def _canonical(extended, thumb, spread, wrist) -> list:
    """The hand built pointing **up**, about `wrist` — `make_hand` rotates it after."""
    long_directions = {}
    for finger in ('index', 'middle', 'ring', 'pinky'):
        base = _rotate(UP, SPREAD_ANGLE[finger]) if spread else UP
        length = EXTENDED_LENGTH if finger in extended else -CURLED_LENGTH
        long_directions[finger] = (base, length)

    points = [(WRIST[0], WRIST[1], 0.0)]
    # 0 wrist, then 1-4 thumb, 5-8 index, 9-12 middle, 13-16 ring, 17-20 pinky.
    if thumb == 'tucked':
        folded = _chain(MCPS['thumb'], (0.3, 0.95), 0.06)
        points.extend(folded[:3])
        points.append((TUCKED_THUMB[0], TUCKED_THUMB[1], 0.0))
    else:
        thumb_direction = THUMB_UP if thumb == 'up' else THUMB_SIDE
        points.extend(_chain(MCPS['thumb'], thumb_direction, 0.17))

    for finger in ('index', 'middle', 'ring', 'pinky'):
        base, length = long_directions[finger]
        points.extend(_chain(MCPS[finger], base, length))

    if thumb == 'contact':
        # The thumb's tip lands on the index tip — the pose `OK` and `Pinch` share.
        index_tip = points[INDEX_TIP]
        points[THUMB_TIP] = (index_tip[0], index_tip[1], 0.0)
    # The knuckles are anatomical positions relative to the *wrist*: a hand whose wrist
    # is elsewhere carries them with it.
    dx, dy = wrist[0] - WRIST[0], wrist[1] - WRIST[1]
    if dx or dy:
        points = [(x + dx, y + dy, z) for x, y, z in points]
    return points


class Landmark:
    """A stand-in for mediapipe's `NormalizedLandmark` (x, y, z)."""

    def __init__(self, x, y, z=0.0):
        self.x, self.y, self.z = x, y, z


def landmarks_of(hand) -> list:
    """The `NormalizedLandmark`-shaped list of a synthetic hand."""
    return [Landmark(x, y, z) for x, y, z in hand.points]
