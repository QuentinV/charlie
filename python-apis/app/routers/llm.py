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
REPO_ID = "mradermacher/Qwen3.5-2B-Polaris-HighIQ-INSTRUCT-i1-GGUF"
FILENAME = "Qwen3.5-2B-Polaris-HighIQ-INSTRUCT.i1-Q4_K_M.gguf"
#REPO_ID = "Qwen/Qwen2.5-1.5B-Instruct-GGUF"
#FILENAME = "qwen2.5-1.5b-instruct-q4_k_m.gguf"
#REPO_ID = "Qwen/Qwen2.5-3B-Instruct-GGUF"
#FILENAME = "qwen2.5-3b-instruct-q8_0.gguf"
# Qwen/Qwen3-1.7B-GGUF
MODEL_PATH = f"/models/{FILENAME}"

llm = None
mcp = None


MCP_WS_URL = "ws://localhost:3000/mcp"

MAX_TURNS  = 10
LOG_THINK  = True       # set False to suppress <think> blocks in logs
MAX_TOKENS = 2048       # max tokens per LLM generation

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

SYSTEM_TEMPLATE = """\
You are a helpful home assistant. Use the available tools to control devices \
and answer questions.

Think step by step inside <think> tags. After reasoning, call tools or give a \
final answer in plain text.

## Available tools

{tool_list}

## Tool call format

Emit one block per call, immediately after </think>:

<tool_call>
{{"name": "tool_name", "arguments": {{"param": "value"}}, "__seq__": 0}}
</tool_call>

## Parallelism via __seq__

- Same __seq__ value  → independent, will run IN PARALLEL
- Higher __seq__ value → depends on lower __seq__ results, runs AFTER them

Example — turn on two lights in parallel, then dim one:
<tool_call>
{{"name": "turn_on_lights", "arguments": {{"room": "living"}},  "__seq__": 0}}
</tool_call>
<tool_call>
{{"name": "turn_on_lights", "arguments": {{"room": "kitchen"}}, "__seq__": 0}}
</tool_call>
<tool_call>
{{"name": "set_brightness",  "arguments": {{"room": "living", "pct": 60}}, "__seq__": 1}}
</tool_call>

Omit __seq__ (defaults to 0) if you only have one call or all are independent.
Do not emit <tool_call> blocks in your final answer — plain text only.
"""

def load_model(): 
    if not os.path.exists(MODEL_PATH):
        print(f"Model not found at {MODEL_PATH}. Downloading from Hugging Face...")
        downloaded_path = hf_hub_download(
            repo_id=REPO_ID,
            filename=FILENAME,
            local_dir="/models"
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
        n_ctx=8192,
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

    global mcp
    mcp = MCPClient(MCP_WS_URL)

@router.post("/ask")
async def ask(request: Request):
    data = await request.json()
    prompt = data.get("prompt")
    
    response = llm.create_chat_completion(
        messages=[
            {"role": "system", "content": "You are a concise assistant. Provide short, direct answers with no filler. Only JSON."},
            #{"role": "user", "content": "Which is faster, a car or a bike?"},
            #{"role": "assistant", "content": '{ "type": "car" }'},
            {"role": "user", "content": prompt}
        ],
        temperature=0.7
    )
    return response["choices"][0]["message"]

TOOL_LIST_ITEM = '- {name}: {description}\n  arguments: {schema}'

def build_tool_list(mcp_tools: list[dict]) -> str:
    lines = []
    for t in mcp_tools:
        schema = t.get("inputSchema", {}).get("properties", {})
        # Drop internal keys if any
        schema = {k: v for k, v in schema.items() if not k.startswith("_")}
        lines.append(TOOL_LIST_ITEM.format(
            name        = t["name"],
            description = t.get("description", ""),
            schema      = json.dumps(schema, ensure_ascii=False),
        ))
    return "\n".join(lines)

THINK_RE     = re.compile(r"<think>(.*?)</think>",         re.DOTALL)
TOOL_CALL_RE = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.DOTALL)

def parse_response(raw: str) -> tuple[str, str, list[dict]]:
    """
    Parse raw model output.
    Returns (think_text, clean_text, tool_calls).
    tool_calls: [{name, arguments, seq, id}]
    """
    think_blocks = THINK_RE.findall(raw)
    think_text   = "\n".join(b.strip() for b in think_blocks)

    # Strip think blocks and tool_call blocks from visible text
    clean = THINK_RE.sub("", raw)
    clean = TOOL_CALL_RE.sub("", clean).strip()

    tool_calls = []
    for m in TOOL_CALL_RE.finditer(raw):
        try:
            obj = json.loads(m.group(1))
        except json.JSONDecodeError as e:
            log.warning(f"Malformed tool_call JSON: {e}\n  raw: {m.group(1)[:120]}")
            continue

        name = obj.get("name", "")
        if not name:
            continue

        args = dict(obj.get("arguments", {}))
        seq  = int(obj.pop("__seq__", args.pop("__seq__", 0)))

        tool_calls.append({
            "id":        str(uuid.uuid4()),
            "name":      name,
            "arguments": args,
            "seq":       seq,
        })

    return think_text, clean, tool_calls

class MCPClient:
    """
    Persistent WebSocket to the Node.js MCP server.
    All in-flight calls share one connection; responses are routed by id.

    Wire protocol (JSON-RPC 2.0):
      → {"jsonrpc":"2.0","id":"<uuid>","method":"tools/call",
         "params":{"name":"...","arguments":{...}}}
      ← {"jsonrpc":"2.0","id":"<uuid>",
         "result":{"content":[{"type":"text","text":"..."}]}}
    """

    def __init__(self, url: str):
        self.url = url
        self._ws: websockets.WebSocketClientProtocol | None = None
        self._pending: dict[str, asyncio.Future] = {}
        self._tools_cache: list[dict] | None = None

    async def connect(self):
        log.info(f"Connecting to MCP server: {self.url}")
        self._ws = await websockets.connect(self.url)
        asyncio.create_task(self._recv_loop())
        log.info("MCP WebSocket ready")

    async def _recv_loop(self):
        try:
            async for raw in self._ws:
                try:
                    msg = json.loads(raw)
                    req_id = msg.get("id")
                    if req_id and req_id in self._pending:
                        fut = self._pending[req_id]
                        if not fut.done():
                            fut.set_result(msg)
                except Exception as e:
                    log.warning(f"MCP recv error: {e}")
        except websockets.ConnectionClosed:
            log.warning("MCP WebSocket closed")
            self._ws = None
            for fut in self._pending.values():
                if not fut.done():
                    fut.cancel()

    async def _ensure_connected(self):
        if self._ws is None or self._ws.closed:
            await self.connect()

    async def _rpc(self, method: str, params: dict, timeout: float = 15.0) -> dict:
        await self._ensure_connected()
        req_id  = str(uuid.uuid4())
        payload = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[req_id] = fut
        await self._ws.send(json.dumps(payload))
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            log.error(f"RPC timeout: {method}")
            return {"error": {"code": -32000, "message": "timeout"}}
        finally:
            self._pending.pop(req_id, None)

    async def call_tool(self, tool_name: str, arguments: dict) -> str:
        response = await self._rpc("tools/call", {"name": tool_name, "arguments": arguments})
        if "error" in response:
            return f"[tool error: {response['error']}]"
        content = response.get("result", {}).get("content", [])
        if content and content[0].get("type") == "text":
            return content[0]["text"]
        return json.dumps(response.get("result", {}))

    async def list_tools(self) -> list[dict]:
        if self._tools_cache is not None:
            return self._tools_cache
        response = await self._rpc("tools/list", {}, timeout=10.0)
        self._tools_cache = response.get("result", {}).get("tools", [])
        return self._tools_cache

    async def close(self):
        if self._ws:
            await self._ws.close()

async def execute_in_seq_groups(
    calls: list[dict],
    mcp: MCPClient,
) -> list[tuple[dict, str]]:
    """
    seq=0 calls all fire together via asyncio.gather.
    seq=1 calls fire only after all seq=0 results are back.
    seq=N after seq=N-1. Results returned in original call order.
    """
    groups: dict[int, list[dict]] = defaultdict(list)
    for call in calls:
        groups[call["seq"]].append(call)

    results_by_id: dict[str, str] = {}

    for seq_key in sorted(groups.keys()):
        group = groups[seq_key]
        log.info(f"  seq={seq_key} parallel batch: {[c['name'] for c in group]}")

        batch = await asyncio.gather(
            *[mcp.call_tool(c["name"], c["arguments"]) for c in group],
            return_exceptions=True,
        )

        for call, result in zip(group, batch):
            if isinstance(result, Exception):
                text = f"[error: {result}]"
                log.error(f"    ✗ {call['name']}: {result}")
            else:
                text = str(result)
                log.info(f"    ✓ {call['name']}: {text[:100]}")
            results_by_id[call["id"]] = text

    return [(c, results_by_id[c["id"]]) for c in calls]

def llm_generate(llm: Llama, messages: list[dict]) -> str:
    response = llm.create_chat_completion(
        messages   = messages,
        max_tokens = MAX_TOKENS,
    )
    return response["choices"][0]["message"]["content"]

async def run_agent(user_message: str, mcp: MCPClient, llm: Llama) -> str:
    """
    Reactive loop with Qwen-native tool calling and model-driven parallelism.

    Per turn:
      1. Pass message history to create_chat_completion (chat template applied automatically)
      2. Parse <think>, <tool_call> blocks from the response content
      3. Execute seq groups in order, calls within each group in parallel
      4. Append assistant message (with <tool_call> blocks in content) + tool results
      5. Repeat until no tool calls → return final answer
    """
    mcp_tools  = await mcp.list_tools()
    tool_list  = build_tool_list(mcp_tools)
    system_msg = SYSTEM_TEMPLATE.format(tool_list=tool_list)

    log.info(f"Tools loaded: {[t['name'] for t in mcp_tools]}")

    messages: list[dict] = [
        {"role": "system", "content": system_msg},
        {"role": "user",   "content": user_message},
    ]

    loop       = asyncio.get_event_loop()
    clean_text = ""

    for turn in range(MAX_TURNS):
        log.info(f"\n══ Turn {turn + 1} ══")

        # ── Generate ─────────────────────────────────────────────────────
        raw = await loop.run_in_executor(None, llm_generate, llm, messages)

        # ── Parse output ─────────────────────────────────────────────────
        think, clean_text, tool_calls = parse_response(raw)

        if think and LOG_THINK:
            log.info(f"<think>\n{think}\n</think>")

        # ── No tool calls → final answer ─────────────────────────────────
        if not tool_calls:
            log.info("No tool calls — final answer ready")
            return clean_text

        seq_groups = sorted(set(c["seq"] for c in tool_calls))
        log.info(
            f"{len(tool_calls)} tool call(s) across "
            f"{len(seq_groups)} seq group(s): {seq_groups}"
        )

        # ── Append raw assistant message (the model's full output including
        #    <tool_call> blocks) so it sees its own reasoning next turn ────
        messages.append({"role": "assistant", "content": raw})

        # ── Execute: seq groups in order, within-group in parallel ────────
        call_results = await execute_in_seq_groups(tool_calls, mcp)

        # ── Inject tool results as individual "tool" messages ─────────────
        # name= is the tool name so the model can match result to call
        for call, result_text in call_results:
            messages.append({
                "role":    "tool",
                "name":    call["name"],
                "content": result_text,
            })

    log.warning("Max turns reached — returning last response")
    return clean_text

@router.post("/llm/chat")
async def ask(request: Request):
    data = await request.json()
    prompt = data.get("prompt")    

    try:
       run_agent(prompt, mcp, llm)

    finally:
        # await mcp.close()
        print("An error happened\n")

    return response["choices"][0]["message"]


 #queries = [
    # Expects: turn_on(living) + turn_on(kitchen) in parallel [seq=0],
    # then set_brightness(living, 60) [seq=1] after both confirm
    #"Turn on the living room and kitchen lights, then dim the living room to 60%.",

    # Single call
    #"What's the temperature in the bedroom?",

    # Model checks sensor [seq=0], then conditionally acts [seq=1]
    #"If the front door is unlocked, lock it and turn on the porch light.",
#]

#for q in queries:
#    print(f"\n{'═' * 60}")
#    print(f"User: {q}")
#    answer = await run_agent(q, mcp, llm)
#    print(f"\nAssistant: {answer}")