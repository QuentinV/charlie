"""Tier 0 — the motion gate.

Pure numpy so it is unit-testable without OpenCV: the caller hands a grayscale
frame (uint8, HxW). A running background model + threshold, plus a
**spatial-cluster** requirement, is what keeps a global light/exposure change
from firing the detector.

The cluster test uses a coarse grid: a *uniform* brightness shift lights up
almost every cell at once (rejected), while a person/pet concentrates in a few
cells (accepted). That is the cheap, allocation-light proxy for a connected
component, and it is deterministic — see `__tests__/test_gate.py`.
"""
from dataclasses import dataclass

import numpy as np

# Grid the frame is split into for the spatial-cluster test (cols x rows).
GRID_COLS = 8
GRID_ROWS = 6


@dataclass
class MotionResult:
    motion: bool
    #: largest per-cell changed ratio (how *localized* the change is).
    score: float
    #: global changed-pixel ratio.
    ratio: float


def downscale(gray: np.ndarray, width: int, height: int) -> np.ndarray:
    """Strided nearest-neighbour resize (float32). Cheap and pure.

    Good enough for the gate; the detector always gets the full-resolution
    frame, so this never degrades detection quality.
    """
    h, w = gray.shape[:2]
    ys = np.linspace(0, h - 1, height).astype(np.int32)
    xs = np.linspace(0, w - 1, width).astype(np.int32)
    return gray[np.ix_(ys, xs)].astype(np.float32)


class MotionGate:
    def __init__(
        self,
        width: int = 160,
        height: int = 120,
        threshold: int = 25,
        cell_min: float = 0.40,
        max_hot_fraction: float = 0.5,
        alpha: float = 0.05,
        warmup: int = 5,
    ):
        self.width = width
        self.height = height
        self.threshold = threshold
        self.cell_min = cell_min
        self.max_hot_fraction = max_hot_fraction
        #: background running-average rate (0 = frozen, useful in tests).
        self.alpha = alpha
        self.warmup = warmup

        self._background: np.ndarray | None = None
        self._frames = 0

    def update(self, gray: np.ndarray) -> MotionResult:
        """Feed one grayscale frame; return whether it shows motion."""
        small = downscale(gray, self.width, self.height)

        # Warm-up: learn the background, report nothing.
        if self._background is None:
            self._background = small.copy()
            self._frames = 1
            return MotionResult(False, 0.0, 0.0)

        if self._frames < self.warmup:
            self._blend(small)
            self._frames += 1
            return MotionResult(False, 0.0, 0.0)

        diff = np.abs(small - self._background)
        mask = diff > self.threshold
        ratio = float(mask.mean())

        cell_ratio = _cell_ratios(mask)
        score = float(cell_ratio.max()) if cell_ratio.size else 0.0
        hot = int((cell_ratio >= self.cell_min).sum())
        hot_fraction = hot / cell_ratio.size if cell_ratio.size else 0.0

        # Localized change: at least one cell strongly changed, but not the
        # whole grid (that would be a global lighting/exposure shift).
        motion = score >= self.cell_min and hot_fraction <= self.max_hot_fraction

        self._blend(small)
        return MotionResult(motion, score, ratio)

    def _blend(self, small: np.ndarray) -> None:
        if self.alpha > 0:
            self._background = (1 - self.alpha) * self._background + self.alpha * small


def _cell_ratios(mask: np.ndarray) -> np.ndarray:
    """Mean changed ratio per grid cell (GRID_ROWS x GRID_COLS)."""
    h, w = mask.shape
    rows = np.array_split(np.arange(h), GRID_ROWS)
    cols = np.array_split(np.arange(w), GRID_COLS)
    out = np.zeros((len(rows), len(cols)), dtype=np.float32)
    for i, r in enumerate(rows):
        for j, c in enumerate(cols):
            if r.size and c.size:
                out[i, j] = mask[np.ix_(r, c)].mean()
    return out
