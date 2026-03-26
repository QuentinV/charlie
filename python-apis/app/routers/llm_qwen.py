import os
from fastapi import APIRouter, Request
from llama_cpp import Llama, llama_cpp
from huggingface_hub import hf_hub_download

router = APIRouter()

# 1. Check if the library itself was compiled with GPU support
supports_gpu = llama_cpp.llama_supports_gpu_offload()
print(f"Llama-cpp-python GPU Support Enabled: {supports_gpu}")

# Model Configuration
REPO_ID = "mradermacher/Qwen3.5-2B-Polaris-HighIQ-INSTRUCT-i1-GGUF"
FILENAME = "Qwen3.5-2B-Polaris-HighIQ-INSTRUCT.i1-Q4_K_M.gguf"
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
        #n_ctx=2048,
        #n_threads=4,
        #n_gpu_layers=-1,
        #n_threads=8,
        #n_batch=512,
        chat_format="chatml",
        n_gpu_layers=1, 
        n_ctx=4096,
        n_threads=2,          
        n_batch=1024,
        offload_kqv=True,     # Critical for iGPU low-latency
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
            {"role": "system", "content": "You are a low-latency tool-use assistant. Respond ONLY with the function call in JSON. Do not explain. Do not think. Do not use <thought> tags."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.7
    )
    return response["choices"][0]["message"]

# You are a high-speed controller. No conversational filler. No <think> tags. Output ONLY the JSON tool call immediately.
#"You are a low-latency tool-use assistant. Respond ONLY with the function call in JSON. Do not explain. Do not think. Do not use <thought> tags."