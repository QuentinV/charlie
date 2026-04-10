import os
from fastapi import APIRouter, Request
from llama_cpp import Llama, llama_cpp
from huggingface_hub import hf_hub_download
import torch

router = APIRouter()

gpu_detected = torch.cuda.is_available()
if gpu_detected:
    print(f"🚀 High Performance: Using {torch.cuda.get_device_name(0)}")
    n_gpu_layers = -1 # Offload all layers
else:
    print("⚠️ No GPU found or Driver missing. Falling back to CPU mode.")
    n_gpu_layers = 0  # Force CPU execution

# Model Configuration
#REPO_ID = "mradermacher/Qwen3.5-2B-Polaris-HighIQ-INSTRUCT-i1-GGUF"
#FILENAME = "Qwen3.5-2B-Polaris-HighIQ-INSTRUCT.i1-Q4_K_M.gguf"
REPO_ID = "Qwen/Qwen2.5-1.5B-Instruct-GGUF"
FILENAME = "qwen2.5-1.5b-instruct-q4_k_m.gguf"
#REPO_ID = "Qwen/Qwen2.5-3B-Instruct-GGUF"
#FILENAME = "qwen2.5-3b-instruct-q8_0.gguf"
# Qwen/Qwen3-1.7B-GGUF
MODEL_PATH = f"/models/{FILENAME}"

llm = None

def load_model(): 
    if not os.path.exists(MODEL_PATH):
        print(f"Model not found at {MODEL_PATH}. Downloading from Hugging Face...")
        downloaded_path = hf_hub_download(
            repo_id=REPO_ID,
            filename=FILENAME,
            local_dir="/models",
            local_dir_use_symlinks=False
        )
        print(f"Download complete: {downloaded_path}")
    else:
        print("Model already exists locally.")

    global llm
    llm = Llama(
        model_path=MODEL_PATH,
        #n_ctx=2048,
        #n_threads=4,
        #n_gpu_layers=-1,
        n_threads=8,
        n_batch=512,
        chat_format="chatml",
        n_gpu_layers=n_gpu_layers, 
        n_ctx=4096,
        #n_threads=2,          
        #n_batch=1024,
        #offload_kqv=True,     # Critical for iGPU low-latency
        #logits_all=False,   # We only need the last token's logit
        #use_mlock=True,     # Pin model in RAM to prevent swapping
        #use_mmap=True,      # Faster loading
        #flash_attn=True,    # CRITICAL: RTX 5060 supports Flash Attention
        verbose=True

    )
    #flash_attn=True
    # n_batch=1024

@router.post("/qwen/ask")
async def ask(request: Request):
    data = await request.json()
    prompt = data.get("prompt")
    
    response = llm.create_chat_completion(
        messages=[
            {"role": "system", "content": "You are a low-latency tool-use assistant."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.7
    )
    return response["choices"][0]["message"]

# You are a high-speed controller. No conversational filler. No <think> tags. Output ONLY the JSON tool call immediately.
# "You are a low-latency tool-use assistant. Respond ONLY with the function call in JSON. Do not explain. Do not think. Do not use <thought> tags."
# You are a helpful assistant for Home Assistant. Respond only with the required JSON tool call. No chatter.