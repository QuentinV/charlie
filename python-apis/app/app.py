
import os
from fastapi import FastAPI, Request, Header, WebSocket
from fastapi.responses import Response
import logging
import io
import struct
import json
import requests
import sys

from routers import stt_vosk, tts, llm, stt_qwen, llm_qwen

app = FastAPI()
logger = logging.getLogger("uvicorn")

sttModel = os.getenv("STT_MODEL")
llmModel = os.getenv("LLM_MODEL")

print(f"Running with LLM_MODEL = {llmModel} and STT_MODEL = {sttModel}")

if llmModel == "mistreal":
    app.include_router(llm.router)
elif llmModel == "qwen":
    llm_qwen.load_model()
    app.include_router(llm_qwen.router)

if sttModel == "vosk":
    stt_vosk.load_model()
    app.include_router(stt_vosk.router)
elif sttModel == "qwen":
    stt_qwen.load_model()
    app.include_router(stt_qwen.router)

app.include_router(tts.router)

@app.get("/")
async def root():
    return {"status": "all systems go"}