
import os
from fastapi import FastAPI, Request, Header, WebSocket
from fastapi.responses import Response
import logging
import io
import struct
import json
import requests
import sys

from routers import stt_vosk, tts, llm, stt_qwen

app = FastAPI()
logger = logging.getLogger("uvicorn")

sttModel = os.getenv("STT_MODEL")

app.include_router(llm.router)
app.include_router(tts.router)

if sttModel == "vosk":
    stt_vosk.load_model()
    app.include_router(stt_vosk.router)
elif sttModel == "qwen":
    stt_qwen.load_model()
    app.include_router(stt_qwen.router)


@app.get("/")
async def root():
    return {"status": "all systems go"}