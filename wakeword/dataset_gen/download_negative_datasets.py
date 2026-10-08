"""Phase 2b — download ambient / speech negative datasets.

microWakeWord trains against large pre-generated spectrogram negatives hosted on
Hugging Face (ambient noise, music, generic speech). This step downloads the
raw audio collections the training config references as
`training_negative_datasets` / `validation_negative_datasets`.

The exact dataset list lives in training/training_parameters.yaml; this script
materialises each configured Hugging Face dataset into data/negatives/<name>/.

Usage:
    python3 dataset_gen/download_negative_datasets.py
"""

from __future__ import annotations

import argparse
from pathlib import Path

import yaml

from common import (  # type: ignore
    NEGATIVES,
    SAMPLE_RATE,
    ensure_dirs,
    resample,
    write_wav,
)

CONFIG = Path(__file__).resolve().parent.parent / "training" / "training_parameters.yaml"

# Fallback list used when the YAML has no explicit list (mirrors the datasets
# microWakeWord recommends in its documentation).
DEFAULT_DATASETS = [
    "kahrendt/microwakeword_negative_datasets",  # bundled ambient/speech features
]


def download_hf_dataset(name: str) -> int:
    """Download a HF audio dataset and store 16 kHz mono WAVs under data/negatives."""
    from datasets import Audio, load_dataset  # type: ignore

    out_dir = NEGATIVES / name.replace("/", "__")
    out_dir.mkdir(parents=True, exist_ok=True)

    # Datasets are registered under a single split alongside their audio column.
    ds = load_dataset(name, split="train", streaming=True)
    try:
        ds = ds.cast_column("audio", Audio(sampling_rate=SAMPLE_RATE))
    except Exception:
        pass

    count = 0
    for i, example in enumerate(ds):
        audio = example.get("audio")
        if not audio:
            continue
        arr = audio.get("array")
        sr = audio.get("sampling_rate", SAMPLE_RATE)
        if arr is None:
            continue
        import numpy as np

        samples = np.asarray(arr, dtype=np.float32)
        if sr != SAMPLE_RATE:
            samples = resample(samples, sr, SAMPLE_RATE)
        write_wav(out_dir / f"{i:06d}.wav", samples)
        count += 1
        if count % 500 == 0:
            print(f"[negatives] {name}: {count} clips")

    print(f"[negatives] {name}: {count} clips → {out_dir}")
    return count


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", action="append", default=[], help="override dataset name(s)")
    parser.add_argument("--limit", type=int, default=0, help="cap clips per dataset (0 = all)")
    args = parser.parse_args()

    ensure_dirs()

    datasets = args.dataset
    if not datasets and CONFIG.exists():
        cfg = yaml.safe_load(CONFIG.read_text())
        datasets = cfg.get("negative_datasets", []) or []
    if not datasets:
        datasets = DEFAULT_DATASETS

    total = 0
    for name in datasets:
        total += download_hf_dataset(name)

    print(f"[negatives] downloaded {total} clips total into {NEGATIVES}")


if __name__ == "__main__":
    main()
