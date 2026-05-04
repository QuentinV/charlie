import os
from fastapi import FastAPI, Request, Header, WebSocket
from fastapi.responses import Response
import logging
import io
import struct
import json
import requests
import sys

from routers import tts, generate_grpc
#, llm_qwen

app = FastAPI()
logger = logging.getLogger("uvicorn")

buildGrpcApi = os.getenv("BUILD_GRPC_API")
if buildGrpcApi:
    generate_grpc.build_protos()

llmModel = os.getenv("LLM_MODEL")
#if llmModel == "":
#    llmModel = "mistreal"

print(f"Running with LLM_MODEL = {llmModel}")
if llmModel == "mistreal":
    from routers import llm
    app.include_router(llm.router)
elif llmModel == "qwen":
    llm_qwen.load_model()
    app.include_router(llm_qwen.router)

app.include_router(tts.router)

@app.get("/")
async def root():
    return {"status": "all systems go"}