"""Phase 2c — acoustic augmentation of positives and traps.

Produces the `data/augmented/` set used to broaden the training distribution:

  * Room Impulse Response (RIR) convolution for 1 m–4 m microphone distance and
    wall reflections,
  * additive ambient noise at several SNRs,
  * gain / time-shift jitter.

microWakeWord itself augments *spectrograms* during training; this waveform-level
stage is complementary and guarantees the acoustic variety PLAN.md §3 Phase 2
calls for.

Usage:
    python3 dataset_gen/augment.py
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from common import (  # type: ignore
    AUGMENTED,
    NEGATIVES,
    POSITIVES,
    SAMPLE_RATE,
    TRAPS,
    ensure_dirs,
    normalize_gain,
    read_wav,
    resample,
    write_wav,
)

SNRS_DB = [5, 10, 20]
RIR_DISTANCES = [1.0, 2.0, 4.0]


def _synthetic_rir(distance_m: float, rt60: float = 0.3) -> np.ndarray:
    """Very cheap synthetic RIR: direct path + exponentially decaying reflections."""
    n = int(rt60 * SAMPLE_RATE)
    if n < 1:
        n = 1
    t = np.arange(n) / SAMPLE_RATE
    rir = np.zeros(n, dtype=np.float32)
    direct_delay = int((distance_m / 343.0) * SAMPLE_RATE)  # speed of sound
    if 0 <= direct_delay < n:
        rir[direct_delay] = 1.0
    reflections = np.random.randn(n).astype(np.float32) * np.exp(-6.0 * t / rt60)
    rir += 0.25 * reflections
    # Normalise energy so convolution does not change loudness wildly.
    rir /= (np.sqrt(np.sum(rir ** 2)) + 1e-9)
    return rir


def _convolve(samples: np.ndarray, rir: np.ndarray) -> np.ndarray:
    return np.convolve(samples, rir, mode="full").astype(np.float32)


def _add_noise(samples: np.ndarray, noise: np.ndarray, snr_db: float) -> np.ndarray:
    if noise.size == 0:
        return samples
    if noise.size < samples.size:
        reps = int(np.ceil(samples.size / noise.size))
        noise = np.tile(noise, reps)
    start = np.random.randint(0, noise.size - samples.size) if noise.size > samples.size else 0
    noise = noise[start : start + samples.size]

    sig_power = float(np.mean(samples ** 2)) + 1e-9
    noise_power = float(np.mean(noise ** 2)) + 1e-9
    target_noise_power = sig_power / (10 ** (snr_db / 10.0))
    scaled = noise * np.sqrt(target_noise_power / noise_power)
    return samples + scaled


def _load_noise_pool(limit: int = 50) -> list[np.ndarray]:
    pool = []
    for path in sorted(NEGATIVES.rglob("*.wav"))[:limit]:
        try:
            samples, sr = read_wav(path)
        except Exception:
            continue
        pool.append(resample(samples, sr, SAMPLE_RATE))
    return pool


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--variants", type=int, default=3, help="augmented variants per source clip")
    args = parser.parse_args()

    ensure_dirs()
    noise_pool = _load_noise_pool()
    print(f"[augment] noise pool: {len(noise_pool)} clips")

    sources = list(POSITIVES.glob("*.wav")) + list(TRAPS.glob("*.wav"))
    total = 0

    for src in sources:
        samples, sr = read_wav(src)
        samples = resample(samples, sr, SAMPLE_RATE)

        for v in range(args.variants):
            aug = samples.copy()

            if noise_pool and np.random.rand() < 0.8:
                noise = noise_pool[np.random.randint(len(noise_pool))]
                aug = _add_noise(aug, noise, float(np.random.choice(SNRS_DB)))

            if np.random.rand() < 0.6:
                rir = _synthetic_rir(float(np.random.choice(RIR_DISTANCES)))
                aug = _convolve(aug, rir)

            aug = aug * float(np.random.uniform(0.7, 1.3))
            if np.random.rand() < 0.5:
                shift = np.random.randint(-400, 400)
                aug = np.roll(aug, shift)

            aug = normalize_gain(aug)
            write_wav(AUGMENTED / f"{src.stem}_aug{v}.wav", aug)
            total += 1

    print(f"[augment] wrote {total} augmented clips → {AUGMENTED}")


if __name__ == "__main__":
    main()
