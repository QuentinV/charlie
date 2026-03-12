
import os
from fastapi import APIRouter, WebSocket
import json
import logging
import requests
from vosk import Model, KaldiRecognizer
from webrtc_noise_gain import AudioProcessor
import time
import pyaudio
import shutil
import zipfile

router = APIRouter()

logger = logging.getLogger("uvicorn")

voskFolder = "/vosk/main"
voskSampleRate = 16000

voskModel = None

def download_and_extract_vosk():
    voskModelKey = os.getenv("VOSK_MODEL_KEY")
    voskZip = voskModelKey + ".zip"
    voskZipPath =  "/vosk/" + voskZip
    voskModelUrl = "https://alphacephei.com/vosk/models/" + voskZip

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

def load_model():
    download_and_extract_vosk()
    global voskModel
    voskModel = Model(voskFolder)

@router.websocket("/stt/vosk/stream")
async def websocket_stt(ws: WebSocket):
    await ws.accept()

    # auto_gain_dbfs: Target level (0 to 31). 10-15 is usually sweet.
    # noise_suppression_level: 0 (low) to 4 (max).
    ap = AudioProcessor(12, 4)
    rec = KaldiRecognizer(voskModel, int(voskSampleRate))
    #rec.SetWords(True)
    #rec.SetMaxAlternatives(3)

    last_result = ""
    audio_buffer = bytearray() 

    while True:
        msg = await ws.receive()

        if msg["type"] == "websocket.disconnect":
            break

        if "text" in msg and msg["text"] == "__END__":
            break

        if "bytes" not in msg:
            continue

        audio_buffer.extend(msg["bytes"])

        while len(audio_buffer) >= 320:
            frame = bytes(audio_buffer[:320])
            del audio_buffer[:320]

            # apply NS + AGC
            processed_frame = ap.Process10ms(frame)

            if rec.AcceptWaveform(processed_frame.audio):
                data = json.loads(rec.Result())
                if data.get("text"):
                    last_result = data["text"]

    # Final result
    final_data = json.loads(rec.FinalResult())
    if not final_data.get("text"):
        final_data["text"] = last_result

    await ws.send_json({"type": "result", "data": final_data })
    await ws.close()