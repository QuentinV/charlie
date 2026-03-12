import os
import numpy as np
import torch
import traceback
import tempfile
from scipy.io import wavfile
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from qwen_asr import Qwen3ASRModel
from modelscope import snapshot_download

router = APIRouter()
language = os.getenv("QWEN_LANGUAGE")

# Configuration
LOCAL_MODEL_DIR = "/models/Qwen3-ASR-0.6B"
MODEL_ID = "Qwen/Qwen3-ASR-0.6B"

model = None

def load_model():    
    # Ensure model exists
    if not os.path.exists(LOCAL_MODEL_DIR) or not os.listdir(LOCAL_MODEL_DIR):
        print(f"Model not found. Downloading {MODEL_ID}...")
        snapshot_download(MODEL_ID, local_dir=LOCAL_MODEL_DIR)

    # Load Qwen3-ASR-0.6B on CPU
    # Use float32 for CPU if bfloat16 causes issues on older hardware
    global model
    model = Qwen3ASRModel.from_pretrained(
        LOCAL_MODEL_DIR,
        device_map="cpu",
        dtype=torch.float32 
    )

@router.websocket("/stt/qwen/stream")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    audio_buffer = []
    
    try:
        while True:
            message = await websocket.receive()
            
            if "bytes" in message:
                data = message["bytes"]
                chunk = np.frombuffer(data, dtype=np.int16)
                audio_buffer.append(chunk)
            
            elif "text" in message:
                text_command = message["text"]
                
                if text_command == "__END__":
                    print("Received __END__ signal. Starting transcription...")
                    
                    if not audio_buffer:
                        await websocket.send_json({"type": "result", data: { "text": "" }})
                        break

                    # Process the collected audio
                    try:
                        full_audio = np.concatenate(audio_buffer)
                        audio_buffer = []
                        
                        # Save to temp file to bypass strict library type-checks
                        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_wav:
                            wavfile.write(tmp_wav.name, 16000, full_audio)
                            tmp_path = tmp_wav.name

                        try:
                            # Transcribe
                            results = model.transcribe(audio=tmp_path, language=language)
                            text_out = getattr(results[0], 'text', "") if results else ""
                            
                            await websocket.send_json({
                                "type": "result",
                                "data": { "text": text_out }
                            })                            
                        finally:
                            if os.path.exists(tmp_path):
                                os.remove(tmp_path)
                                
                    except Exception as e:
                        print(f"Transcription Error: {e}")
                        traceback.print_exc()

                    break

    except WebSocketDisconnect:
        print("Client disconnected.")
    except Exception as e:
        print(f"Socket Error: {e}")
        traceback.print_exc()