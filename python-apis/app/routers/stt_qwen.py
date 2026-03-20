import os
import numpy as np
import torch
import traceback
import tempfile
from scipy.io import wavfile
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from qwen_asr import Qwen3ASRModel
from modelscope import snapshot_download
import time
import gc

gc.collect()
torch.cuda.empty_cache()

#help(Qwen3ASRModel.from_pretrained)

router = APIRouter()
language = os.getenv("STT_LANGUAGE")
if language == "":
    language = "French"

print(f"Running with STT_LANGUAGE = {language}")

# Configuration
LOCAL_MODEL_ASR_DIR = "/models/Qwen3-ASR-0.6B"
MODEL_ASR_ID = "Qwen/Qwen3-ASR-0.6B"

model = None
context="This is a conversation with an assistant named Charlie."

def load_model():    
    # Ensure model exists
    if not os.path.exists(LOCAL_MODEL_ASR_DIR) or not os.listdir(LOCAL_MODEL_ASR_DIR):
        print(f"Model ASR not found. Downloading {MODEL_ASR_ID}...")
        snapshot_download(MODEL_ASR_ID, local_dir=LOCAL_MODEL_ASR_DIR)

    # Load Qwen3-ASR-0.6B on CPU
    # Use float32 for CPU if bfloat16 causes issues on older hardware
    global model
    model = Qwen3ASRModel.from_pretrained(
        LOCAL_MODEL_ASR_DIR,
        device_map="cpu",
        dtype=torch.float32, 
        #dtype=torch.bfloat16, 
        low_cpu_mem_usage=True,
        max_new_tokens = 128,
        attn_implementation="sdpa" # Scaled Dot Product Attention
    )

    print("🚀 Warming up engine...")
    try:
        with torch.no_grad():
            dummy_audio = np.zeros(16000)

            # Save to temp file to bypass strict library type-checks
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_wav:
                wavfile.write(tmp_wav.name, 16000, dummy_audio)
                tmp_path = tmp_wav.name
            
            model.transcribe(
                audio=tmp_path, 
                language=language,
                context = context
            )
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
    
    print("✨ Engine Hot & Ready")


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
                        await websocket.send_json({"type": "result", "data": { "text": "", "execution_time": 0 }})
                        break

                    start_time = time.perf_counter()

                    # Process the collected audio
                    try:
                        full_audio = np.concatenate(audio_buffer)
                        audio_buffer = []
                        
                        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_wav:
                            wavfile.write(tmp_wav.name, 16000, full_audio)
                            tmp_path = tmp_wav.name

                        print(f"Writting to temp file took: {time.perf_counter() - start_time:.4f} seconds")

                        try:
                            with torch.no_grad():
                                results = model.transcribe(
                                    audio = tmp_path, 
                                    language = language,
                                    context = context
                                )
                                
                                text_out = getattr(results[0], 'text', "") if results else ""
                                
                                # Calculate final duration
                                execution_time = time.perf_counter() - start_time
                                
                                print(f"Text: {text_out}")
                                print(f"Transcription took: {execution_time:.4f} seconds")
                                
                                await websocket.send_json({
                                    "type": "result",
                                    "text": text_out,
                                    "execution_time": execution_time
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