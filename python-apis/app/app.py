
import os
from fastapi import FastAPI, Request, Header, WebSocket
from fastapi.responses import Response
import logging
import io
import struct
import json
import requests
import sys


from routers import stt_vosk, tts, llm

app = FastAPI()
logger = logging.getLogger("uvicorn")

app.include_router(llm.router)
app.include_router(stt_vosk.router)
app.include_router(tts.router)

@app.get("/")
async def root():
    return {"status": "all systems go"}