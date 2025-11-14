
import os
from fastapi import FastAPI, Request, Header
from fastapi.responses import Response
from mistralai import Mistral
from mistralai.extra.run.context import RunContext
from mcp import StdioServerParameters
from mistralai.extra.mcp.stdio import MCPClientSTDIO
from mistralai.extra.mcp.sse import MCPClientSSE, SSEServerParams
from piper.voice import PiperVoice
import logging
import io
import struct

app = FastAPI()
logger = logging.getLogger("uvicorn")

sse_host = os.getenv("SSE_HOST")
client = Mistral(api_key=os.getenv("MISTRAL_API_KEY"))
agent_id = os.getenv("AGENT_ID")
cached_tools = None

if sse_host != "":
    logger.info("Starting in SSE mode with SSE_HOST=%s", sse_host)
else:
     logger.info("Starting in stdio mode")

@app.post("/ask")
async def ask(request: Request):
    body = await request.json()
    question = body.get("question", "Hello")
        
    if sse_host != "":
        mcp_client = MCPClientSSE(sse_params=SSEServerParams(url=sse_host, timeout=5000))
    else :
        server_params = StdioServerParameters(
            command="yarn",
            args=["--silent", "run", "stdio_mcp"],
            cwd="/mcp-server"
        )
        mcp_client = MCPClientSTDIO(stdio_params=server_params)
        
    #tools = await mcp_client.get_tools()

    #global cached_tools
    #needRegister = cached_tools != tools
    #if needRegister:
    #    cached_tools = tools

    async with RunContext(agent_id=agent_id) as run_ctx:
     #   if needRegister:
        await run_ctx.register_mcp_client(mcp_client)
        run_result = await client.beta.conversations.run_async(
            run_ctx=run_ctx,
            inputs=question,
        )

    return run_result
        
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

@app.post("/tts")
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