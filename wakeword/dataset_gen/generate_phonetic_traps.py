"""Phase 2a — generate phonetic hard negatives ("traps") that resemble Charlie.

These are French words sharing phonemes with "Charlie" (/ʃaʁ.li/). They are used
as high-penalty negatives so the model rejects near-misses like "Chérie".

Usage:
    python3 dataset_gen/generate_phonetic_traps.py
"""

from __future__ import annotations

import argparse

from common import (  # type: ignore
    TRAPS,
    SAMPLE_RATE,
    ensure_dirs,
    ensure_piper_voice,
    trim_silence,
    write_wav,
)

# Words that phonetically overlap with "Charlie".
TRAP_WORDS = [
    "Chalet",
    "Chérie",
    "Chérie !",
    "Charlie's",
    "Charger",
    "Chapeau",
    "Charles",
    "Cherbourg",
    "Charleroi",
    "Charline",
    "Charlot",
    "Charli",
    "Charlène",
    "Charmille",
    "Charbons",
    "Chariot",
    "Charlotte",
    "Sharlie",
    "Tcharlie",
    "Charly",
]

VOICES = ["fr_FR-upmc-medium", "fr_FR-siwis-medium"]
LENGTH_SCALES = [0.85, 1.0, 1.15, 1.30]


def _synthesize(voice, text: str, length_scale: float):
    import numpy as np

    try:
        from piper import SynthesisConfig  # type: ignore

        cfg = SynthesisConfig(length_scale=length_scale)
        chunks = []
        for chunk in voice.synthesize(text, syn_config=cfg):
            arr = np.frombuffer(chunk.audio_int16_bytes, dtype=np.int16).astype(np.float32) / 32768.0
            chunks.append(arr)
        return np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
    except (ImportError, TypeError):
        import io
        import wave

        from common import resample  # type: ignore

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            voice.synthesize(text, wf, length_scale=length_scale)
        buf.seek(0)
        with wave.open(buf, "rb") as wf:
            sr = wf.getframerate()
            raw = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
        return resample(raw.astype(np.float32) / 32768.0, sr, SAMPLE_RATE)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    ensure_dirs()
    total = 0

    for voice_id in VOICES:
        onnx, config = ensure_piper_voice(voice_id)

        from piper.voice import PiperVoice  # type: ignore

        voice = PiperVoice.load(str(onnx), config_path=str(config))

        for word in TRAP_WORDS:
            for length_scale in LENGTH_SCALES:
                safe = word.strip().replace(" ", "").replace("'", "")
                path = TRAPS / f"{voice_id}_{safe}_ls{length_scale}.wav"
                if path.exists():
                    total += 1
                    continue

                samples = trim_silence(_synthesize(voice, word, length_scale))
                if samples.size < SAMPLE_RATE // 10:
                    continue
                write_wav(path, samples)
                total += 1
                if args.limit and total >= args.limit:
                    print(f"[traps] reached limit ({total} clips)")
                    return

    print(f"[traps] generated {total} clips in {TRAPS}")


if __name__ == "__main__":
    main()
