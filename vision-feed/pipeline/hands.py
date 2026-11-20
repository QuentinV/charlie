"""The 21 hand landmarks → the features the rules read. Pure: no mediapipe, no I/O.

MediaPipe's `GestureRecognizerResult` carries the hand landmarks **already computed**
(`hand_landmarks`, `hand_world_landmarks`, `handedness`) next to the gesture categories,
and the recognizer is asked on every frame anyway (`main.run_feed`) — so the geometric
vocabulary in `pipeline/gesture_rules.py` costs nothing but arithmetic.

Everything here is deliberately **2D and scale-invariant**:

- distances are divided by the palm scale (wrist → middle MCP), so the same sign at 1 m
  and at 3 m measures the same;
- only the image plane (x, y) is used. MediaPipe's z is *wrist-relative* and its
  `handedness` is defined for a **mirrored** (selfie) image, so a "is the palm facing the
  camera" test would need empirical calibration on recorded frames — while extend /
  contact / spread / direction are exact on the plane, and they are what the vocabulary
  actually needs (`Stop` vs `Five` is spread vs closed, not palm vs back of hand).

Landmark indices are MediaPipe's own (identical for every hand task):
0 wrist; 1-4 thumb (CMC, MCP, IP, tip); 5-8 index; 9-12 middle; 13-16 ring; 17-20 pinky.
"""
import math
from dataclasses import dataclass

WRIST = 0
THUMB_MCP, THUMB_TIP = 2, 4
INDEX_MCP, INDEX_TIP = 5, 8
MIDDLE_MCP, MIDDLE_TIP = 9, 12
RING_MCP, RING_TIP = 13, 16
PINKY_MCP, PINKY_TIP = 17, 20

#: `finger → (mcp, tip)`: the two landmarks every measurement needs.
FINGERS = {
    'thumb': (THUMB_MCP, THUMB_TIP),
    'index': (INDEX_MCP, INDEX_TIP),
    'middle': (MIDDLE_MCP, MIDDLE_TIP),
    'ring': (RING_MCP, RING_TIP),
    'pinky': (PINKY_MCP, PINKY_TIP),
}

#: `tip reach` (tip distance to the wrist ÷ MCP distance to the wrist) at or above which
#: a finger counts as extended. Measured proportions put a straight finger near 1.8 (the
#: palm is ~10 cm, the finger ~8 cm) and a curled one near 0.7 (the tip comes back to
#: mid-palm), so the band between 1.2 and 1.5 is deliberately "not extended": a half
#: curl is not evidence for a sign. **Calibrated on recorded frames**
#: (`recorder.py` + `probe_gestures.py`) — the single number to move if a real hand
#: measures differently.
EXTEND_RATIO = 1.5
#: The thumb has no straight chain to compare (its MCP sits beside the wrist), so its
#: extension is measured against the **index MCP**: a tucked thumb's tip lands near the
#: palm's width, an extended one well beyond it.
THUMB_EXTEND_RATIO = 1.25
#: Thumb-tip ↔ index-tip distance (÷ palm scale) that counts as a contact (`OK`/`Pinch`).
CONTACT_RATIO = 0.40
#: The smallest adjacent-finger tip gap (÷ palm scale) that counts as a **spread** hand.
#: Fingers together measure ~0.2, a spread hand ~0.6: this is what tells `Stop` (spread)
#: from `Five` (together) without asking which side of the hand faces the camera.
SPREAD_RATIO = 0.45


def _distance(a, b) -> float:
    """Image-plane distance (x, y) — see the module docstring on z."""
    return math.hypot(a[0] - b[0], a[1] - b[1])


@dataclass(frozen=True)
class Hand:
    """One detected hand: 21 normalized landmarks + who it is."""

    points: tuple
    handedness: str = ''
    score: float = 0.0
    #: MediaPipe's metric landmarks (metres), when the result carries them — the motion
    #: tier reads depth (`Push`/`Pull`) from here.
    world: tuple | None = None

    def point(self, index: int) -> tuple:
        return self.points[index]

    @property
    def palm_scale(self) -> float:
        """Wrist → middle MCP. Every other distance is divided by this."""
        scale = _distance(self.points[WRIST], self.points[MIDDLE_MCP])
        return scale if scale > 1e-6 else 1e-6

    def reach(self, finger: str) -> float:
        """How far a finger's tip is from the wrist, in palm scales."""
        _, tip = FINGERS[finger]
        return _distance(self.points[tip], self.points[WRIST]) / self.palm_scale

    def extended(self, finger: str) -> bool:
        """True when the finger is straight enough to be part of a sign."""
        if finger == 'thumb':
            base = _distance(self.points[INDEX_MCP], self.points[WRIST])
            if base <= 1e-6:
                return False
            return (
                _distance(self.points[THUMB_TIP], self.points[WRIST]) / base
                >= THUMB_EXTEND_RATIO
            )
        return self.reach(finger) >= EXTEND_RATIO

    def curled(self, finger: str) -> bool:
        return not self.extended(finger)

    def contact_ratio(self, a: int = THUMB_TIP, b: int = INDEX_TIP) -> float:
        """Tip-to-tip distance in palm scales — the raw number `contact` thresholds.

        Exposed because a threshold is only as good as the number it compares: the
        recorder's probe (`probe_gestures.py`) prints this per label, so
        `CONTACT_RATIO` is calibrated on measured hands instead of guessed.
        """
        return _distance(self.points[a], self.points[b]) / self.palm_scale

    def contact(self, a: int = THUMB_TIP, b: int = INDEX_TIP) -> bool:
        """True when two tips touch (thumb ↔ index: `OK` / `Pinch`)."""
        return self.contact_ratio(a, b) <= CONTACT_RATIO

    def tip_gap(self, a: str, b: str) -> float:
        """Distance between two fingertips, in palm scales (the spread test)."""
        _, tip_a = FINGERS[a]
        _, tip_b = FINGERS[b]
        return _distance(self.points[tip_a], self.points[tip_b]) / self.palm_scale

    def spread(self, fingers=('index', 'middle', 'ring', 'pinky')) -> bool:
        """True when the fingers are held apart — `Stop` rather than `Five`.

        The **smallest** adjacent gap decides: a hand where one pair touches is a closed
        hand with a gap, not a spread one.
        """
        gaps = [
            self.tip_gap(fingers[i], fingers[i + 1])
            for i in range(len(fingers) - 1)
        ]
        return bool(gaps) and min(gaps) >= SPREAD_RATIO

    def direction_name(self, tip: int) -> str:
        """Which way the wrist→tip axis points in the **image** ('left' of the picture).

        Image-space on purpose: a sign is a picture-space instruction ("swipe left" is
        left on the screen), and it is the only reading that does not depend on
        MediaPipe's mirrored handedness. Ties (a 45° point) go to the vertical axis, so
        the result is always one of four names — a total partition, no `None` band.
        """
        dx = self.points[tip][0] - self.points[WRIST][0]
        dy = self.points[tip][1] - self.points[WRIST][1]
        if abs(dx) > abs(dy):
            return 'right' if dx > 0 else 'left'
        return 'down' if dy > 0 else 'up'


def hand_from_landmarks(landmarks, handedness: str = '', score: float = 0.0,
                        world=None) -> Hand | None:
    """A `Hand` from a landmark list, or None when it is not a full hand (21 points)."""
    if not landmarks:
        return None
    points = []
    for landmark in landmarks:
        try:
            points.append((float(landmark.x), float(landmark.y), float(landmark.z)))
        except (AttributeError, TypeError, ValueError):
            return None
    if len(points) < 21:
        return None
    world_points = None
    if world:
        try:
            world_points = tuple(
                (float(p.x), float(p.y), float(p.z)) for p in world
            )
        except (AttributeError, TypeError, ValueError):
            world_points = None
    return Hand(tuple(points), handedness, float(score or 0.0), world_points)


def hands_from_result(result) -> list:
    """Every hand a recognizer result carries (`[]` when it carries none).

    Reads the same result object the gesture categories come from, so the two can never
    disagree about how many hands were seen.
    """
    landmarks = getattr(result, 'hand_landmarks', None) or []
    worlds = getattr(result, 'hand_world_landmarks', None) or []
    handedness = getattr(result, 'handedness', None) or []
    hands = []
    for index, points in enumerate(landmarks):
        label, score = '', 0.0
        categories = handedness[index] if index < len(handedness) else None
        if categories:
            label = str(getattr(categories[0], 'category_name', '') or '')
            score = float(getattr(categories[0], 'score', 0.0) or 0.0)
        world = worlds[index] if index < len(worlds) else None
        hand = hand_from_landmarks(points, label, score, world)
        if hand is not None:
            hands.append(hand)
    return hands
