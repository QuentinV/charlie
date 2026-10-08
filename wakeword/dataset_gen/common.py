"""Shared helpers for the Charlie wake-word dataset pipeline.

All audio in this project is mono, 16-bit PCM, 16 kHz — matching the
microWakeWord frontend (40-channel log-mel, 30 ms window / 10 ms hop).
"""

from __future__ import annotations

import urllib.request
import wave
from pathlib import Path

import numpy as np

# --- Audio constants (must match the on-device frontend) --------------------
SAMPLE_RATE = 16000
BIT_DEPTH = 16
NUM_CHANNELS = 1

# --- Directories ------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
POSITIVES = DATA / "positives"
TRAPS = DATA / "traps"
NEGATIVES = DATA / "negatives"
USER_AUDIO = DATA / "user_audio"
AUGMENTED = DATA / "augmented"
VOICES_DIR = DATA / "voices"

# Where the device firmware library lives (for later header export).
ECHO_LIB = ROOT.parent / "echo-devices" / "libs" / "ESP32HomeAssistant"

WAKE_WORD = "Charlie"


def ensure_dirs() -> None:
    for d in (POSITIVES, TRAPS, NEGATIVES, USER_AUDIO, AUGMENTED, VOICES_DIR):
        d.mkdir(parents=True, exist_ok=True)


# --- WAV I/O ----------------------------------------------------------------
def write_wav(path: Path, samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> None:
    """Write a float32/int16 numpy array as 16-bit mono PCM WAV."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if samples.dtype != np.int16:
        samples = np.clip(samples, -1.0, 1.0)
        samples = (samples * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(NUM_CHANNELS)
        wf.setsampwidth(BIT_DEPTH // 8)
        wf.setframerate(sample_rate)
        wf.writeframes(samples.tobytes())


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    """Read a WAV file and return (float32 mono in [-1, 1], sample_rate)."""
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        channels = wf.getnchannels()
        width = wf.getsampwidth()
        frames = wf.readframes(wf.getnframes())

    if width == 2:
        data = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    elif width == 1:
        data = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128) / 128.0
    elif width == 4:
        data = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"Unsupported sample width {width}")

    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)

    return data, sr


# --- Signal helpers ---------------------------------------------------------
def trim_silence(samples: np.ndarray, threshold: float = 0.01, pad: int = 160) -> np.ndarray:
    """Remove leading/trailing near-silence, keeping `pad` samples of context."""
    if samples.size == 0:
        return samples
    energy = np.abs(samples)
    idx = np.where(energy > threshold)[0]
    if idx.size == 0:
        return samples
    start = max(0, idx[0] - pad)
    end = min(samples.size, idx[-1] + pad)
    return samples[start:end]


def normalize_gain(samples: np.ndarray, target_peak: float = 0.9) -> np.ndarray:
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak < 1e-6:
        return samples
    return (samples / peak) * target_peak


def resample(samples: np.ndarray, orig_sr: int, target_sr: int = SAMPLE_RATE) -> np.ndarray:
    """Resample using librosa (imported lazily to keep base deps light)."""
    if orig_sr == target_sr:
        return samples
    import librosa

    return librosa.resample(samples, orig_sr=orig_sr, target_sr=target_sr)


# --- Piper voice download ---------------------------------------------------
PIPER_VOICES_BASE = (
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/{path}/{name}"
)

# voice id -> repository path under rhasspy/piper-voices
FRENCH_VOICES = {
    "fr_FR-upmc-medium": "fr/fr_FR/upmc/medium/fr_FR-upmc-medium",
    "fr_FR-siwis-medium": "fr/fr_FR/siwis/medium/fr_FR-siwis-medium",
}


def ensure_piper_voice(voice_id: str) -> tuple[Path, Path]:
    """Download (once) and return the (onnx, onnx.json) paths for a Piper voice."""
    rel = FRENCH_VOICES[voice_id]
    name = rel.split("/")[-1]
    onnx = VOICES_DIR / f"{name}.onnx"
    config = VOICES_DIR / f"{name}.onnx.json"
    VOICES_DIR.mkdir(parents=True, exist_ok=True)

    for target, suffix in ((onnx, ".onnx"), (config, ".onnx.json")):
        if target.exists():
            continue
        url = PIPER_VOICES_BASE.format(path=rel, name=name + suffix)
        print(f"[piper] downloading {url}")
        urllib.request.urlretrieve(url, target)

    return onnx, config
