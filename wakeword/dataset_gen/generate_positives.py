"""Phase 1 — generate synthetic French "Charlie" positives with Piper TTS.

Sweeps speed (length scale) and expressiveness (noise scales) to build a
diverse, speaker-varied positive set. Output is 16 kHz / 16-bit mono WAV.

Usage:
    python3 dataset_gen/generate_positives.py
"""

from __future__ import annotations

import argparse
import wave
from pathlib import Path

import numpy as np

from common import (  # type: ignore
    POSITIVES,
    SAMPLE_RATE,
    WAKE_WORD,
    ensure_dirs,
    ensure_piper_voice,
    resample,
    trim_silence,
    write_wav,
)

# Parametric sweeps (PLAN.md §3 Phase 1)
LENGTH_SCALES = [round(0.75 + 0.05 * i, 2) for i in range(12)]  # 0.75 → 1.30
NOISE_SCALES = [0.3, 0.5, 0.667, 0.8]
NOISE_W_SCALES = [0.5, 0.8]

VOICES = ["fr_FR-upmc-medium", "fr_FR-siwis-medium"]

# A few spelling/punctuation variants so Piper phonemises slightly differently.
TEXT_VARIANTS = ["Charlie", "Charlie.", "Charlie !", "charlie"]


def _synthesize(voice, text: str, length_scale: float, noise_scale: float, noise_w: float) -> np.ndarray:
    """Return float32 mono samples for `text`, handling both Piper APIs."""
    try:
        # piper-tts >= 1.2 new API
        from piper import SynthesisConfig  # type: ignore

        cfg = SynthesisConfig(
            length_scale=length_scale,
            noise_scale=noise_scale,
            noise_w_scale=noise_w,
        )
        chunks = []
        for chunk in voice.synthesize(text, syn_config=cfg):
            arr = np.frombuffer(chunk.audio_int16_bytes, dtype=np.int16).astype(np.float32) / 32768.0
            chunks.append(arr)
        return np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
    except (ImportError, TypeError):
        # Legacy API: synthesize(text, wav_file, ...) writes a wave file.
        import io

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            voice.synthesize(
                text,
                wf,
                length_scale=length_scale,
                noise_scale=noise_scale,
                noise_w=noise_w,
            )
        buf.seek(0)
        with wave.open(buf, "rb") as wf:
            sr = wf.getframerate()
            raw = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
        data = raw.astype(np.float32) / 32768.0
        return resample(data, sr, SAMPLE_RATE)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="cap the number of clips (0 = no cap)")
    args = parser.parse_args()

    ensure_dirs()
    total = 0

    for voice_id in VOICES:
        onnx, config = ensure_piper_voice(voice_id)

        from piper.voice import PiperVoice  # type: ignore

        voice = PiperVoice.load(str(onnx), config_path=str(config))

        for length_scale in LENGTH_SCALES:
            for noise_scale in NOISE_SCALES:
                for noise_w in NOISE_W_SCALES:
                    for text in TEXT_VARIANTS:
                        name = f"{voice_id}_ls{length_scale}_ns{noise_scale}_nw{noise_w}_{text.strip().replace(' ', '')}"
                        path = POSITIVES / f"{name}.wav"
                        if path.exists():
                            total += 1
                            continue

                        samples = _synthesize(voice, text, length_scale, noise_scale, noise_w)
                        samples = trim_silence(samples)
                        if samples.size < SAMPLE_RATE // 10:
                            continue
                        write_wav(path, samples)

                        total += 1
                        if args.limit and total >= args.limit:
                            print(f"[positives] reached limit ({total} clips)")
                            return

    print(f"[positives] generated {total} clips in {POSITIVES}")


if __name__ == "__main__":
    main()
