
import os
from fastapi import FastAPI, Request, Header, WebSocket
from fastapi.responses import Response
import logging
import io
import struct
import json
import requests
import sys

from routers import tts, llm, stt_qwen, llm_qwen

app = FastAPI()
logger = logging.getLogger("uvicorn")

llmModel = os.getenv("LLM_MODEL")
if llmModel == None:
    llmModel = "mistreal"

print(f"Running with LLM_MODEL = {llmModel}")

if llmModel == "mistreal":
    app.include_router(llm.router)
elif llmModel == "qwen":
    llm_qwen.load_model()
    app.include_router(llm_qwen.router)

if os.getenv("LOAD_STT_MODEL") != "false":
    stt_qwen.load_model()
    app.include_router(stt_qwen.router)

app.include_router(tts.router)

@app.get("/")
async def root():
    return {"status": "all systems go"}