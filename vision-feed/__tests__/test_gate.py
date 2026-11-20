"""Tier 0 motion-gate tests — pure numpy, no OpenCV, no model.

The key property: a *localized* change is motion, a *global* brightness shift is
not. That is what keeps the detector from firing on every light/exposure change.
"""
import numpy as np

from pipeline.gate import MotionGate, downscale


def _gate(**kw) -> MotionGate:
    # alpha=0 freezes the background so the assertions are deterministic.
    return MotionGate(width=160, height=120, warmup=2, alpha=0.0, **kw)


def _warm(gate: MotionGate, value: int = 100) -> np.ndarray:
    frame = np.full((120, 160), value, dtype=np.uint8)
    gate.update(frame)  # init
    gate.update(frame)  # warm-up
    return frame


def test_static_frame_is_not_motion():
    gate = _gate()
    frame = _warm(gate)
    res = gate.update(frame)
    assert res.motion is False
    assert res.score == 0.0


def test_localized_block_is_motion():
    gate = _gate()
    frame = _warm(gate)
    moving = frame.copy()
    moving[40:70, 60:100] = 200  # a bright block in a couple of grid cells
    res = gate.update(moving)
    assert res.motion is True
    assert res.score > 0.5


def test_uniform_brightness_shift_is_rejected():
    gate = _gate()
    _warm(gate)
    res = gate.update(np.full((120, 160), 200, dtype=np.uint8))
    assert res.ratio > 0.9  # the whole frame changed…
    assert res.motion is False  # …so it is lighting, not an object


def test_warmup_reports_no_motion():
    gate = _gate()
    assert gate.update(np.full((120, 160), 100, dtype=np.uint8)).motion is False


def test_downscale_shape():
    out = downscale(np.zeros((240, 320), dtype=np.uint8), 160, 120)
    assert out.shape == (120, 160)
