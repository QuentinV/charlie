from fastapi import APIRouter, Request, Header
from fastapi.responses import Response
import struct
import json
from piper.voice import PiperVoice

router = APIRouter()

voice = PiperVoice.load("/app/voices/fr_FR-upmc-medium.onnx", config_path="/app/voices/fr_FR-upmc-medium.onnx.json")

def build_wav_header(sample_rate, sample_width, channels, data_size):
    # WAV header for PCM format
    byte_rate = sample_rate * channels * sample_width
    block_align = channels * sample_width
    header = struct.pack('<4sI4s4sIHHIIHH4sI',
        b'RIFF',
        36 + data_size,
        b'WAVE',
        b'fmt ',
        16,
        1,  # PCM format
        channels,
        sample_rate,
        byte_rate,
        block_align,
        sample_width * 8,
        b'data',
        data_size
    )
    return header

@router.post("/tts")
async def generate_tts(request: Request, accept: str = Header(default="audio/L16")):
    body = await request.json()
    text = body.get("text")

    if not text:
        return {"error": "Missing 'text' in request body"}

    chunks = []
    sample_rate = sample_width = channels = None
    total_size = 0

    for chunk in voice.synthesize(text):
        if sample_rate is None:
            sample_rate = chunk.sample_rate
            sample_width = chunk.sample_width
            channels = chunk.sample_channels
        chunks.append(chunk.audio_int16_bytes)
        total_size += len(chunk.audio_int16_bytes)

    audio_data = b"".join(chunks)

    if "audio/wav" in accept:
        wav_header = build_wav_header(sample_rate, sample_width, channels, total_size)
        return Response(
            content=wav_header + audio_data,
            media_type="audio/wav",
            headers={"Content-Disposition": "inline; filename=speech.wav"}
        )
    else:
        return Response(
            content=audio_data,
            media_type="audio/L16; rate=22050; channels=1",
            headers={"Content-Disposition": "inline; filename=speech.pcm"}
        )
