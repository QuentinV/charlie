"""Phase 1b — ingest real microphone recordings into the training set.

Two sources:
  * data/user_audio/*.wav  → real wake-word samples  → data/positives/user_*.wav
    (short clips that actually contain "Charlie")
  * ../nodejs-apis/recordings/*.wav → post-wake-word command speech, i.e. real
    French speech that must NOT trigger → data/negatives/user_speech/
    (these come from nodejs-apis/src/echo/logs.ts)

All audio is normalised to 16 kHz / 16-bit mono, silence-trimmed and peak
normalised.

Usage:
    python3 dataset_gen/ingest_user_samples.py
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from common import (  # type: ignore
    NEGATIVES,
    POSITIVES,
    ROOT,
    SAMPLE_RATE,
    USER_AUDIO,
    ensure_dirs,
    normalize_gain,
    read_wav,
    resample,
    trim_silence,
    write_wav,
)

# Real command-speech recordings produced by the Charlie brain.
NODEJS_RECORDINGS = ROOT.parent / "nodejs-apis" / "recordings"


def _prepare(path: Path):
    samples, sr = read_wav(path)
    samples = resample(samples, sr, SAMPLE_RATE)
    samples = trim_silence(samples)
    samples = normalize_gain(samples)
    return samples


def ingest_wake_words() -> int:
    count = 0
    for src in sorted(USER_AUDIO.glob("*.wav")):
        dst = POSITIVES / f"user_{src.stem}.wav"
        if dst.exists():
            count += 1
            continue
        samples = _prepare(src)
        if samples.size < SAMPLE_RATE // 10:
            print(f"[ingest] skipping {src.name} (too short)")
            continue
        write_wav(dst, samples)
        count += 1
    return count


def ingest_command_speech() -> int:
    out_dir = NEGATIVES / "user_speech"
    out_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    if not NODEJS_RECORDINGS.exists():
        return 0
    for src in sorted(NODEJS_RECORDINGS.glob("*.wav")):
        dst = out_dir / f"cmd_{src.stem}.wav"
        if dst.exists():
            count += 1
            continue
        try:
            samples = _prepare(src)
        except Exception as exc:  # pragma: no cover - defensive
            print(f"[ingest] skipping {src.name}: {exc}")
            continue
        if samples.size < SAMPLE_RATE // 10:
            continue
        write_wav(dst, samples)
        count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-nodejs", action="store_true", help="skip nodejs-apis recordings")
    args = parser.parse_args()

    ensure_dirs()

    n_pos = ingest_wake_words()
    print(f"[ingest] {n_pos} wake-word samples → {POSITIVES}")

    if not args.no_nodejs:
        n_neg = ingest_command_speech()
        print(f"[ingest] {n_neg} command-speech negatives → {NEGATIVES / 'user_speech'}")


if __name__ == "__main__":
    main()
