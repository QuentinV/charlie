import asyncio
import io
import logging
import os
import sqlite3
import urllib.request
import numpy as np
import sherpa_onnx
import soundfile as sf
from fastapi import FastAPI, File, HTTPException, UploadFile
import uvicorn
from wyoming.audio import AudioChunk, AudioStart, AudioStop
from wyoming.event import Event
from wyoming.server import AsyncEventHandler, AsyncServer

logging.basicConfig(level=logging.INFO)
_LOGGER = logging.getLogger("voice-profiler")

# Model configuration switched to VoxCeleb (Global / French-friendly)
MODEL_DIR = "./models"
MODEL_FILENAME = "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx"
MODEL_PATH = os.path.join(MODEL_DIR, MODEL_FILENAME)
DB_PATH = "./data/users.db"

# 2. Initialize SQLite Database for Persistence
def init_db():
  os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
  conn = sqlite3.connect(DB_PATH)
  cursor = conn.cursor()
  cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            embedding BLOB
        )
    """)
  conn.commit()
  conn.close()


init_db()

# 3. Initialize Sherpa-ONNX Speaker Extractor
extractor = sherpa_onnx.SpeakerEmbeddingExtractor(
    sherpa_onnx.SpeakerEmbeddingExtractorConfig(
        model=MODEL_PATH,
        num_threads=2,
    )
)


def load_user_database() -> dict:
  conn = sqlite3.connect(DB_PATH)
  cursor = conn.cursor()
  cursor.execute("SELECT username, embedding FROM users")
  rows = cursor.fetchall()
  conn.close()

  db = {}
  for username, blob in rows:
    db[username] = np.frombuffer(blob, dtype=np.float32)
  _LOGGER.info(f"Loaded {len(db)} user profile(s) from SQLite database.")
  return db


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

    audio_np = (
        np.frombuffer(self.audio_buffer, dtype=np.int16).astype(np.float32)
        / 32768.0
    )
    query_embedding = extract_embedding(audio_np, self.sample_rate)
    if query_embedding is None:
      _LOGGER.info("Not enough audio to compute a speaker embedding.")
      await self._send_result("unknown", 0.0)
      self.audio_buffer.clear()
      return

    best_match = "unknown"
    max_similarity = 0.0

    query_norm = float(np.linalg.norm(query_embedding))
    if query_norm > 0.0 and USER_DATABASE:
      for username, ref_embedding in USER_DATABASE.items():
        ref_norm = float(np.linalg.norm(ref_embedding))
        if ref_norm == 0.0:
          continue
        similarity = float(
            np.dot(query_embedding, ref_embedding) / (query_norm * ref_norm)
        )
        if similarity > max_similarity:
          max_similarity = similarity
          best_match = username

    threshold = 0.65
    identified_user = best_match if max_similarity >= threshold else "unknown"

    _LOGGER.info(
        f"Identified: {identified_user} (Similarity: {max_similarity:.2f})"
    )
    await self._send_result(identified_user, max_similarity)
    self.audio_buffer.clear()

  async def _send_result(self, speaker: str, score: float):
    result_event = Event(
        type="speaker-identified", data={"speaker": speaker, "score": score}
    )
    await self.write_event(result_event)


# --- FASTAPI REST APP ---
app = FastAPI()


@app.post("/register/{username}")
async def register_speaker(username: str, file: UploadFile = File(...)):
  audio_bytes = await file.read()
  audio_data, sample_rate = sf.read(io.BytesIO(audio_bytes))

  if audio_data.ndim > 1:
    audio_data = audio_data.mean(axis=1)

  embedding = extract_embedding(audio_data.astype(np.float32), sample_rate)
  if embedding is None:
    raise HTTPException(
        status_code=400,
        detail="Audio sample is too short for a speaker embedding",
    )

  conn = sqlite3.connect(DB_PATH)
  cursor = conn.cursor()
  cursor.execute(
      "INSERT OR REPLACE INTO users (username, embedding) VALUES (?, ?)",
      (username, embedding.tobytes()),
  )
  conn.commit()
  conn.close()

  USER_DATABASE[username] = embedding
  _LOGGER.info(f"Successfully registered and persisted profile for: {username}")
  return {"status": "success", "username": username}


@app.get("/users")
async def list_users():
  return {"registered_users": list(USER_DATABASE.keys())}


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