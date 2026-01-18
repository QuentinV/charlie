
import os
from fastapi import FastAPI, Request, Header, WebSocket
from fastapi.responses import Response
from mistralai import Mistral
from mistralai.extra.run.context import RunContext
from mcp import StdioServerParameters
from mistralai.extra.mcp.stdio import MCPClientSTDIO
from mistralai.extra.mcp.sse import MCPClientSSE, SSEServerParams
from piper.voice import PiperVoice
from vosk import Model, KaldiRecognizer
import logging
import io
import struct
import json
import zipfile
import requests
import shutil

app = FastAPI()
logger = logging.getLogger("uvicorn")

sse_host = os.getenv("SSE_HOST")
client = Mistral(api_key=os.getenv("MISTRAL_API_KEY"))
agent_id = os.getenv("AGENT_ID")
cached_tools = None

voskModelKey = os.getenv("VOSK_MODEL_KEY")
voskZip = voskModelKey + ".zip"
voskZipPath =  "/vosk/" + voskZip
voskModelUrl = "https://alphacephei.com/vosk/models/" + voskZip
voskFolder = "/vosk/main"
voskSampleRate = 16000

if sse_host != "":
    logger.info("Starting in SSE mode with SSE_HOST=%s", sse_host)
else:
     logger.info("Starting in stdio mode")

def download_and_extract_vosk():
    if os.path.isdir(voskFolder):
        logger.info(f"Folder '{voskFolder}' already exists. Skipping download.")
        return

    logger.info(f"Downloading vosk model '{voskModelUrl}'...")
    r = requests.get(voskModelUrl, stream=True)
    r.raise_for_status()

    with open(voskZipPath, "wb") as f:
        for chunk in r.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)

    logger.info("Download vosk complete.")

    logger.info("Extracting vosk model...")
    with zipfile.ZipFile(voskZipPath, "r") as zip_ref:
        # Find the top-level folder inside the ZIP
        top_level_dirs = {name.split('/')[0] for name in zip_ref.namelist()}
        inner_folder = next(iter(top_level_dirs))

        # Extract to a temp directory
        zip_ref.extractall(".")

    os.makedirs(voskFolder, exist_ok=True)
    for item in os.listdir(inner_folder):
        src = os.path.join(inner_folder, item)
        dst = os.path.join(voskFolder, item)
        shutil.move(src, dst)

    shutil.rmtree(inner_folder)

    logger.info("Vosk model extraction complete.")
    os.remove(voskZipPath)

download_and_extract_vosk()
voskModel = Model(voskFolder)

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

@app.websocket("/stt/stream")
async def websocket_stt(ws: WebSocket):
    await ws.accept()

    rec = KaldiRecognizer(voskModel, int(voskSampleRate))

    last_result = ""
    while True:
        msg = await ws.receive()

        if msg["type"] == "websocket.disconnect":
            break

        if "text" in msg and msg["text"] == "__END__":
            break

        if "bytes" not in msg:
            continue

        chunk = msg["bytes"]

        if rec.AcceptWaveform(chunk):
            data = json.loads(rec.Result())
            if data.get("text"):
                last_result = data["text"]
        else:
            await ws.send_json({"type": "partial", "data": json.loads(rec.PartialResult())})

    # Final result
    final_data = json.loads(rec.FinalResult())
    if not final_data.get("text"):
        final_data["text"] = last_result

    await ws.send_json({"type": "result", "data": final_data})
    await ws.close()