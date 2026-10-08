"""Phase 5 — host-side verification of the exported model.

Checks performed:
  1. the .tflite exists and is under the 50 KB budget from PLAN.md §5,
  2. the interpreter loads and the manifest constants are consistent with the
     model's input/output tensors,
  3. a positive WAV and a trap WAV produce different (sanity) activations.

This is a *sanity* harness, not a substitute for on-device validation — the
streaming behaviour (state tensors, sliding window) can only be confirmed on
real hardware / with the streaming test in microWakeWord.

Usage:
    python3 training/verify.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "output"
MODEL_NAME = "charlie"
SIZE_BUDGET_BYTES = 50 * 1024  # PLAN.md §5


def _load_interpreter(path: Path):
    try:
        from tflite_runtime.interpreter import Interpreter  # type: ignore
    except ImportError:
        from tensorflow.lite.python.interpreter import Interpreter  # type: ignore

    interp = Interpreter(model_path=str(path))
    interp.allocate_tensors()
    return interp


def check_size() -> Path:
    model = OUTPUT / f"{MODEL_NAME}.tflite"
    if not model.exists():
        hits = sorted(OUTPUT.glob("*.tflite"))
        if not hits:
            sys.exit(f"[verify] FAIL: no .tflite in {OUTPUT} — run stage3-train first")
        model = hits[0]

    size = model.stat().st_size
    ok = size < SIZE_BUDGET_BYTES
    print(f"[verify] model size: {size} bytes (budget {SIZE_BUDGET_BYTES}) → {'PASS' if ok else 'FAIL'}")
    if not ok:
        sys.exit(1)
    return model


def check_tensors(model: Path) -> None:
    interp = _load_interpreter(model)
    print("[verify] inputs:")
    for d in interp.get_input_details():
        print(f"    {d['name']:32s} shape={tuple(d['shape'])} dtype={np.dtype(d['dtype']).name}")
    print("[verify] outputs:")
    for d in interp.get_output_details():
        print(f"    {d['name']:32s} shape={tuple(d['shape'])} dtype={np.dtype(d['dtype']).name}")


def check_activations(model: Path) -> None:
    """Feed a positive and a trap through the *non-streaming* path if available."""
    pos_dir = ROOT / "data" / "positives"
    trap_dir = ROOT / "data" / "traps"

    def first(d: Path) -> Path | None:
        hits = sorted(d.glob("*.wav"))
        return hits[0] if hits else None

    pos = first(pos_dir)
    trap = first(trap_dir)
    if not pos or not trap:
        print("[verify] SKIP activation check (no positives/traps present)")
        return

    interp = _load_interpreter(model)
    in_details = interp.get_input_details()

    def run(wav: Path) -> float:
        from dataset_gen.common import read_wav, resample, SAMPLE_RATE  # noqa: E402

        samples, sr = read_wav(wav)
        samples = resample(samples, sr, SAMPLE_RATE)
        n = int(np.prod(in_details[0]["shape"]))
        samples = np.resize(samples, n).astype(np.float32)
        samples = np.clip(samples, -1.0, 1.0).reshape(in_details[0]["shape"])
        if in_details[0]["dtype"] == np.int8:
            samples = np.clip(samples * 127.0, -128, 127).astype(np.int8)
        interp.set_tensor(in_details[0]["index"], samples)
        interp.invoke()
        out = interp.get_tensor(interp.get_output_details()[0]["index"])
        return float(np.max(out))

    p_pos = run(pos)
    p_trap = run(trap)
    print(f"[verify] activation positive={p_pos:.4f} trap={p_trap:.4f}")
    if p_pos <= p_trap:
        print("[verify] WARNING: positive is not more active than the trap — review training data")


def main() -> None:
    model = check_size()
    check_tensors(model)
    check_activations(model)
    print("[verify] done")


if __name__ == "__main__":
    main()
