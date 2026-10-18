import asyncio
import io
import logging
import math
import os
import sqlite3

import numpy as np
import sherpa_onnx
import soundfile as sf
import uvicorn
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from wyoming.audio import AudioChunk, AudioStart, AudioStop
from wyoming.event import Event
from wyoming.server import AsyncEventHandler, AsyncServer

logging.basicConfig(level=logging.INFO)
_LOGGER = logging.getLogger("voice-profiler")

# --- Model / storage -------------------------------------------------------

MODEL_DIR = "./models"
MODEL_FILENAME = "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx"
MODEL_PATH = os.path.join(MODEL_DIR, MODEL_FILENAME)
DB_PATH = "./data/users.db"


def _env_float(name: str, default: float) -> float:
  try:
    return float(os.environ.get(name, default))
  except (TypeError, ValueError):
    return default


def _env_int(name: str, default: int) -> int:
  try:
    return int(os.environ.get(name, default))
  except (TypeError, ValueError):
    return default


# Identification: a mystery utterance only names its speaker above this cosine.
MATCH_THRESHOLD = _env_float("VOICE_MATCH_THRESHOLD", 0.65)

# Enrolment: the held-out sentence (the last one recorded) must match the
# profile built from the previous ones above this cosine, and the samples must
# agree with each other at least MIN_CONSISTENCY. Both gates are needed: the
# first is the same comparison identification performs, the second rejects a
# noisy sentence that would poison the centroid.
ENROLL_THRESHOLD = _env_float("VOICE_ENROLL_THRESHOLD", 0.50)
MIN_CONSISTENCY = _env_float("VOICE_MIN_CONSISTENCY", 0.45)

# Audio quality gates. The prompted sentences are 2-5 s of speech; a shorter
# recording cannot produce a stable embedding, and silence/clipping produce a
# meaningless one. Echo microphone captures land around -44 dBFS, so the level
# gate only rejects near-silence.
MIN_SAMPLE_SECONDS = _env_float("VOICE_MIN_SAMPLE_SECONDS", 1.2)
MIN_RMS_DB = _env_float("VOICE_MIN_RMS_DB", -55.0)
MAX_CLIPPING_RATIO = _env_float("VOICE_MAX_CLIPPING_RATIO", 0.05)
MIN_IDENTIFY_SECONDS = _env_float("VOICE_MIN_IDENTIFY_SECONDS", 0.4)

# Display-only mapping of the raw cosine to a 0..1 confidence. Decisions are
# always taken on the raw score against MATCH_THRESHOLD.
SCORE_FLOOR = _env_float("VOICE_SCORE_FLOOR", 0.20)
SCORE_CEIL = _env_float("VOICE_SCORE_CEIL", 0.80)

# A profile is the centroid of its samples; keep a bounded history so a stale
# recording from months ago cannot dominate forever.
MAX_SAMPLES_PER_USER = _env_int("VOICE_MAX_SAMPLES_PER_USER", 10)


# --- Persistence -----------------------------------------------------------


def _db():
  return sqlite3.connect(DB_PATH)


def init_db():
  os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
  conn = _db()
  cursor = conn.cursor()
  # Legacy table (one embedding per user). Kept so an existing database is
  # migrated in place; new profiles only ever live in `voice_samples`.
  cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            embedding BLOB
        )
    """)
  cursor.execute("""
        CREATE TABLE IF NOT EXISTS voice_samples (
            username TEXT NOT NULL,
            sample_idx INTEGER NOT NULL,
            embedding BLOB NOT NULL,
            added_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (username, sample_idx)
        )
    """)
  # One-shot migration: a legacy single-sample profile becomes sample #0.
  cursor.execute("""
        INSERT OR IGNORE INTO voice_samples (username, sample_idx, embedding)
        SELECT username, 0, embedding FROM users
        WHERE username NOT IN (SELECT username FROM voice_samples)
    """)
  conn.commit()
  conn.close()


def load_user_database() -> dict:
  """Load every profile as an `(N, D)` array of normalised embeddings."""
  conn = _db()
  cursor = conn.cursor()
  cursor.execute(
      "SELECT username, embedding FROM voice_samples"
      " ORDER BY username, sample_idx"
  )
  rows = cursor.fetchall()
  conn.close()

  grouped: dict = {}
  for username, blob in rows:
    embedding = np.frombuffer(blob, dtype=np.float32)
    if embedding.size == 0:
      continue
    grouped.setdefault(username, []).append(l2_normalize(embedding))

  db = {username: np.stack(samples) for username, samples in grouped.items()}
  _LOGGER.info(
      "Loaded %s profile(s) / %s sample(s) from SQLite database.",
      len(db),
      sum(len(samples) for samples in db.values()),
  )
  return db


def save_profile(username: str, embeddings: list) -> int:
  """Replace a profile with `embeddings` (atomically, newest last)."""
  embeddings = embeddings[-MAX_SAMPLES_PER_USER:]
  conn = _db()
  cursor = conn.cursor()
  try:
    cursor.execute("DELETE FROM voice_samples WHERE username = ?", (username,))
    # `users` is legacy: never let it resurrect a deleted profile on restart.
    cursor.execute("DELETE FROM users WHERE username = ?", (username,))
    for index, embedding in enumerate(embeddings):
      cursor.execute(
          "INSERT INTO voice_samples (username, sample_idx, embedding)"
          " VALUES (?, ?, ?)",
          (username, index, np.asarray(embedding, dtype=np.float32).tobytes()),
      )
    conn.commit()
  finally:
    conn.close()

  USER_DATABASE[username] = np.stack(
      [l2_normalize(embedding) for embedding in embeddings]
  )
  return len(embeddings)


def delete_profile(username: str) -> bool:
  conn = _db()
  cursor = conn.cursor()
  try:
    deleted = cursor.execute(
        "DELETE FROM voice_samples WHERE username = ?", (username,)
    ).rowcount
    cursor.execute("DELETE FROM users WHERE username = ?", (username,))
    conn.commit()
  finally:
    conn.close()
  USER_DATABASE.pop(username, None)
  return deleted > 0


init_db()

# --- Embedding maths -------------------------------------------------------


def l2_normalize(vector) -> np.ndarray:
  """Unit-length copy of `vector` (a zero vector is returned unchanged)."""
  value = np.asarray(vector, dtype=np.float32)
  norm = float(np.linalg.norm(value))
  if norm <= 0.0:
    return value
  return value / norm


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
  """Cosine similarity of two already normalised embeddings."""
  return float(np.dot(a, b))


def _centroid(embeddings) -> np.ndarray:
  """Normalised mean of normalised embeddings (the profile's core vector)."""
  stacked = np.stack([l2_normalize(embedding) for embedding in embeddings])
  return l2_normalize(np.mean(stacked, axis=0))


def score_against_profile(query_embedding, samples) -> dict:
  """Score a query against a multi-sample profile.

  The centroid is stable but averages away intra-speaker variation; the best
  single sample keeps the recall of a distinctive recording. The reported
  score is the better of the two, so a profile can only gain from having
  several samples.
  """
  query = l2_normalize(query_embedding)
  normalised = [l2_normalize(sample) for sample in samples]
  centroid_score = _cosine(query, _centroid(normalised))
  best_sample_score = max(
      (_cosine(query, sample) for sample in normalised), default=0.0
  )
  return {
      "score": float(max(centroid_score, best_sample_score)),
      "centroid_score": float(centroid_score),
      "best_sample_score": float(best_sample_score),
      "samples": len(normalised),
  }


def calibrate(score: float) -> float:
  """Map a raw cosine to a 0..1 display confidence (never used to decide)."""
  span = SCORE_CEIL - SCORE_FLOOR
  if span <= 0.0:
    return 0.0
  return float(min(1.0, max(0.0, (score - SCORE_FLOOR) / span)))


# --- Audio preparation -----------------------------------------------------


def _trim_silence(
    audio: np.ndarray,
    sample_rate: int,
    frame_ms: float = 25.0,
    margin_ms: float = 200.0,
    relative_threshold: float = 0.08,
) -> np.ndarray:
  """Keep the spoken span of an utterance (leading/trailing silence removed).

  The energy reference is the loudest 25 ms frame: a relative threshold keeps
  this independent of the microphone gain, and a 200 ms margin preserves the
  beginning/end of the first and last words.
  """
  if audio.size == 0:
    return audio

  frame = max(1, int(sample_rate * frame_ms / 1000.0))
  if audio.size <= frame:
    return audio

  usable = audio[: audio.size - (audio.size % frame)]
  frames = usable.reshape(-1, frame)
  energy = np.sqrt(np.mean(np.square(frames, dtype=np.float64), axis=1))
  peak = float(np.max(energy)) if energy.size else 0.0
  if peak <= 0.0:
    return np.zeros(0, dtype=np.float32)

  voiced = np.flatnonzero(energy >= peak * relative_threshold)
  if voiced.size == 0:
    return np.zeros(0, dtype=np.float32)

  margin = int(sample_rate * margin_ms / 1000.0)
  start = max(0, voiced[0] * frame - margin)
  end = min(audio.size, (voiced[-1] + 1) * frame + margin)
  return audio[start:end]


def audio_metrics(audio: np.ndarray, sample_rate: int) -> dict:
  """Level/quality metrics attached to every recorded sample."""
  duration = float(audio.size) / float(sample_rate) if sample_rate else 0.0
  if audio.size:
    rms = float(np.sqrt(np.mean(np.square(audio, dtype=np.float64))))
    clipping = float(np.mean(np.abs(audio) >= 0.98))
  else:
    rms = 0.0
    clipping = 0.0
  rms_db = 20.0 * math.log10(rms) if rms > 0.0 else -120.0
  return {
      "duration_s": round(duration, 2),
      "rms_db": round(max(rms_db, -120.0), 1),
      "clipping": round(clipping, 4),
  }


def prepare_sample(audio: np.ndarray, sample_rate: int):
  """Quality-gate a recorded sample.

  Returns `(trimmed_audio, metrics, reason)`; `reason` is None when the sample
  is usable, otherwise one of `too_short` / `silent` / `clipped`.
  """
  metrics = audio_metrics(audio, sample_rate)
  if metrics["duration_s"] < MIN_SAMPLE_SECONDS:
    return None, metrics, "too_short"
  if metrics["rms_db"] < MIN_RMS_DB:
    return None, metrics, "silent"
  if metrics["clipping"] > MAX_CLIPPING_RATIO:
    return None, metrics, "clipped"

  trimmed = _trim_silence(audio, sample_rate)
  spoken = float(trimmed.size) / float(sample_rate) if sample_rate else 0.0
  if spoken < MIN_SAMPLE_SECONDS * 0.6:
    return None, metrics, "too_short"

  metrics["spoken_s"] = round(spoken, 2)
  return trimmed, metrics, None


def evaluate_enrollment(embeddings) -> dict:
  """Score a set of enrolment samples; the last one is held out.

  * `test`          — last sample vs the centroid of the previous ones, i.e.
                      exactly the comparison identification makes later;
  * `loo_min`       — worst sample vs the centroid of the others (consistency);
  * `centroid_mean` — mean sample-to-centroid similarity.
  """
  normalised = [l2_normalize(embedding) for embedding in embeddings]
  count = len(normalised)

  loo_scores = []
  for index in range(count):
    others = [e for i, e in enumerate(normalised) if i != index]
    loo_scores.append(_cosine(normalised[index], _centroid(others)))

  outliers = [
      index for index, score in enumerate(loo_scores) if score < MIN_CONSISTENCY
  ]

  # The held-out sample is compared with the centroid of the *usable*
  # previous samples: a noisy first sentence must not fail an honest third one.
  reference = [
      embedding
      for index, embedding in enumerate(normalised[:-1])
      if index not in outliers
  ]
  if not reference:
    reference = normalised[:-1]
  test_score = (
      _cosine(normalised[-1], _centroid(reference)) if count >= 2 else 0.0
  )

  centroid_vector = _centroid(normalised)
  centroid_mean = float(
      np.mean([_cosine(e, centroid_vector) for e in normalised])
  )

  kept = [e for i, e in enumerate(normalised) if i not in outliers]
  if not kept:
    kept = normalised

  accepted = (
      count >= 3
      and test_score >= ENROLL_THRESHOLD
      and min(loo_scores) >= MIN_CONSISTENCY
  )

  return {
      "accepted": bool(accepted),
      "test": round(float(test_score), 4),
      "loo_min": round(float(min(loo_scores)), 4),
      "loo_mean": round(float(np.mean(loo_scores)), 4),
      "centroid_mean": round(centroid_mean, 4),
      "per_sample": [round(float(score), 4) for score in loo_scores],
      "outliers": outliers,
      "kept": kept,
  }


# --- Model -----------------------------------------------------------------

# 3. Initialize Sherpa-ONNX Speaker Extractor
extractor = sherpa_onnx.SpeakerEmbeddingExtractor(
    sherpa_onnx.SpeakerEmbeddingExtractorConfig(
        model=MODEL_PATH,
        num_threads=2,
    )
)

USER_DATABASE = load_user_database()


def extract_embedding(audio_np: np.ndarray, sample_rate: int):
  """Compute a speaker embedding, or None when there is not enough audio.

  sherpa-onnx returns the embedding from `SpeakerEmbeddingExtractor.compute()`
  — there is no `stream.embedding` and no `get_embedding()`.
  """
  stream = extractor.create_stream()
  stream.accept_waveform(
      sample_rate, np.ascontiguousarray(audio_np, dtype=np.float32)
  )
  stream.input_finished()

  if not extractor.is_ready(stream):
    return None

  return np.asarray(extractor.compute(stream), dtype=np.float32)


# --- WYOMING TCP EVENT HANDLER ---
class MinimalVoiceProfileHandler(AsyncEventHandler):

  def __init__(self, *args, **kwargs):
    super().__init__(*args, **kwargs)
    self.audio_buffer = bytearray()
    self.sample_rate = 16000

  async def handle_event(self, event: Event) -> bool:
    if AudioStart.is_type(event.type):
      audio_start = AudioStart.from_event(event)
      self.sample_rate = audio_start.rate
      self.audio_buffer.clear()
      return True

    if AudioChunk.is_type(event.type):
      chunk = AudioChunk.from_event(event)
      self.audio_buffer.extend(chunk.audio)
      return True

    if AudioStop.is_type(event.type):
      await self._identify_speaker()
      return False

    return True

  async def _identify_speaker(self):
    if not self.audio_buffer:
      await self._send_result("unknown", 0.0)
      return

    raw = (
        np.frombuffer(self.audio_buffer, dtype=np.int16).astype(np.float32)
        / 32768.0
    )
    audio_np = _trim_silence(raw, self.sample_rate)
    metrics = audio_metrics(audio_np, self.sample_rate)
    if metrics["duration_s"] < MIN_IDENTIFY_SECONDS:
      _LOGGER.info(
          "Not enough audio to identify a speaker (%ss).",
          metrics["duration_s"],
      )
      await self._send_result("unknown", 0.0)
      self.audio_buffer.clear()
      return

    query_embedding = extract_embedding(audio_np, self.sample_rate)
    if query_embedding is None:
      _LOGGER.info("Not enough audio to compute a speaker embedding.")
      await self._send_result("unknown", 0.0)
      self.audio_buffer.clear()
      return

    best_match = "unknown"
    best = {"score": 0.0, "samples": 0}
    for username, samples in USER_DATABASE.items():
      try:
        result = score_against_profile(query_embedding, samples)
      except ValueError:
        # Stored with another embedding model/dimension: ignore that profile.
        _LOGGER.warning("Profile %s has incompatible embeddings", username)
        continue
      if result["score"] > best["score"]:
        best = result
        best_match = username

    score = float(best["score"])
    identified_user = best_match if score >= MATCH_THRESHOLD else "unknown"

    _LOGGER.info(
        "Identified: %s (score=%.3f, threshold=%.2f, samples=%s)",
        identified_user,
        score,
        MATCH_THRESHOLD,
        best["samples"],
    )
    await self._send_result(
        identified_user,
        score,
        confidence=calibrate(score),
        samples=int(best["samples"]),
    )
    self.audio_buffer.clear()

  async def _send_result(
      self,
      speaker: str,
      score: float,
      confidence: float = 0.0,
      samples: int = 0,
  ):
    result_event = Event(
        type="speaker-identified",
        data={
            "speaker": speaker,
            "score": score,
            "confidence": confidence,
            "threshold": MATCH_THRESHOLD,
            "samples": samples,
        },
    )
    await self.write_event(result_event)


# --- FASTAPI REST APP ---
app = FastAPI()


def _rejected(username: str, index: int, reason: str, metrics: list) -> dict:
  _LOGGER.info(
      "Enrolment rejected for %s: sample #%s (%s)", username, index, reason
  )
  return {
      "status": "rejected",
      "username": username,
      "accepted": False,
      "committed": False,
      "samples": len(metrics),
      "sample_index": index,
      "reason": reason,
      "metrics": metrics,
  }


async def _read_sample(file: UploadFile):
  audio_bytes = await file.read()
  audio, sample_rate = sf.read(io.BytesIO(audio_bytes), dtype="float32")
  if audio.ndim > 1:
    audio = audio.mean(axis=1)
  return audio, sample_rate


@app.post("/enroll/{username}")
async def enroll_speaker(
    username: str,
    files: list[UploadFile] = File(...),
    commit: bool = Query(True),
):
  """Multi-sample enrolment with a held-out verification sample.

  The last uploaded sample is scored against the profile built from the other
  ones (the same comparison used at identification time). The profile is only
  committed when that score and the sample-to-sample consistency pass their
  thresholds, so a noisy enrolment never replaces a working profile.
  """
  username = username.strip()
  if not username:
    raise HTTPException(status_code=400, detail="username is required")
  if len(files) < 2:
    raise HTTPException(
        status_code=400, detail="at least two samples are required"
    )

  embeddings = []
  metrics = []
  for index, file in enumerate(files):
    try:
      audio, sample_rate = await _read_sample(file)
    except Exception as exc:
      return _rejected(username, index, "unreadable", metrics) | {
          "detail": str(exc)
      }

    sample, metric, reason = prepare_sample(audio, sample_rate)
    metrics.append(metric)
    if reason:
      return _rejected(username, index, reason, metrics)

    embedding = extract_embedding(sample, sample_rate)
    if embedding is None:
      return _rejected(username, index, "no_embedding", metrics)
    embeddings.append(embedding)

  report = evaluate_enrollment(embeddings)
  accepted = bool(report["accepted"])
  committed = accepted and commit
  kept_samples = len(report["kept"])

  if committed:
    save_profile(username, report["kept"])

  status = "success" if accepted else "low_confidence"
  _LOGGER.info(
      "Enrolment %s for %s: %s sample(s), test=%.3f, loo_min=%.3f, %s",
      status,
      username,
      len(embeddings),
      report["test"],
      report["loo_min"],
      "committed" if committed else "not committed",
  )

  return {
      "status": status,
      "username": username,
      "accepted": accepted,
      "committed": committed,
      "samples": len(embeddings),
      "kept_samples": kept_samples,
      "threshold": ENROLL_THRESHOLD,
      "consistency_threshold": MIN_CONSISTENCY,
      "confidence": round(calibrate(float(report["test"])), 4),
      "scores": {
          "test": report["test"],
          "loo_min": report["loo_min"],
          "loo_mean": report["loo_mean"],
          "centroid_mean": report["centroid_mean"],
          "per_sample": report["per_sample"],
      },
      "metrics": metrics,
  }


@app.post("/register/{username}")
async def register_speaker(username: str, file: UploadFile = File(...)):
  """Legacy one-shot enrolment: replace the profile with a single sample."""
  username = username.strip()
  if not username:
    raise HTTPException(status_code=400, detail="username is required")

  audio, sample_rate = await _read_sample(file)
  sample, metrics, reason = prepare_sample(audio, sample_rate)
  if reason:
    raise HTTPException(
        status_code=400, detail=f"audio rejected: {reason} ({metrics})"
    )

  embedding = extract_embedding(sample, sample_rate)
  if embedding is None:
    raise HTTPException(
        status_code=400,
        detail="Audio sample is too short for a speaker embedding",
    )

  save_profile(username, [embedding])
  _LOGGER.info("Registered a single-sample profile for: %s", username)
  return {"status": "success", "username": username, "samples": 1}


@app.get("/users")
async def list_users():
  return {"registered_users": list(USER_DATABASE.keys())}


@app.get("/profiles/{username}")
async def get_profile(username: str):
  samples = USER_DATABASE.get(username)
  if samples is None:
    raise HTTPException(status_code=404, detail="profile not found")
  return {
      "username": username,
      "samples": int(len(samples)),
      "dim": int(samples.shape[1]),
      "threshold": MATCH_THRESHOLD,
  }


@app.delete("/profiles/{username}")
async def delete_profile_route(username: str):
  if not delete_profile(username):
    raise HTTPException(status_code=404, detail="profile not found")
  _LOGGER.info("Deleted the voice profile of: %s", username)
  return {"status": "deleted", "username": username}


# --- ASYNC MAIN RUNNER ---
async def main():
  wyoming_server = AsyncServer.from_uri("tcp://0.0.0.0:10400")
  _LOGGER.info("Wyoming TCP Server listening on port 10400...")
  wyoming_task = asyncio.create_task(
      # Wyoming calls the factory with (reader, writer): forward them to the
      # handler, exactly like asr/server.py does.
      wyoming_server.run(
          lambda *handler_args: MinimalVoiceProfileHandler(*handler_args)
      )
  )

  config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="info")
  fastapi_server = uvicorn.Server(config)
  _LOGGER.info("FastAPI Registration Server listening on port 8000...")

  await asyncio.gather(wyoming_task, fastapi_server.serve())


if __name__ == "__main__":
  asyncio.run(main())
