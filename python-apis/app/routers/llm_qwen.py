import os
from fastapi import APIRouter, Request
from llama_cpp import Llama
from huggingface_hub import hf_hub_download

router = APIRouter()

# Model Configuration
REPO_ID = "bartowski/Qwen2.5-3B-Instruct-GGUF"
FILENAME = "Qwen2.5-3B-Instruct-Q4_K_M.gguf"
MODEL_PATH = f"/models/{FILENAME}"

llm = None

def load_model(): 
    if not os.path.exists(MODEL_PATH):
        print(f"Model not found at {MODEL_PATH}. Downloading from Hugging Face...")
        # This downloads the file and returns the local path
        downloaded_path = hf_hub_download(
            repo_id=REPO_ID,
            filename=FILENAME,
            local_dir="/models",
            local_dir_use_symlinks=False
        )
        print(f"Download complete: {downloaded_path}")
    else:
        print("Model already exists locally.")

    # Initialize Llama with CPU optimizations
    global llm
    llm = Llama(
        model_path=MODEL_PATH,
        n_ctx=2048,
        n_threads=4, # Adjust to your CPU cores
        n_batch=512,
        chat_format="chatml"
    )
    #flash_attn=True
    # n_batch=1024

@router.post("/qwen/ask")
async def ask(request: Request):
    data = await request.json()
    prompt = data.get("prompt")
    
    response = llm.create_chat_completion(
        messages=[
            {"role": "system", "content": "You are a helpful assistant. Think step-by-step."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.7
    )
    return response["choices"][0]["message"]

# You are a high-speed controller. No conversational filler. No <think> tags. Output ONLY the JSON tool call immediately.