
import os
from fastapi import APIRouter, Request
from mistralai import Mistral
from mistralai.extra.run.context import RunContext
from mcp import StdioServerParameters
from mistralai.extra.mcp.stdio import MCPClientSTDIO
from mistralai.extra.mcp.sse import MCPClientSSE, SSEServerParams
import logging
import json

logger = logging.getLogger("uvicorn")
router = APIRouter()

sse_host = os.getenv("SSE_HOST")
client = Mistral(api_key=os.getenv("MISTRAL_API_KEY"))
cached_tools = None

if sse_host != "":
    logger.info("Starting in SSE mode with SSE_HOST=%s", sse_host)
else:
     logger.info("Starting in stdio mode")

AGENT_FILE = "agent.json"
AGENT_VERSION = 1

CUSTOM_PROMPT = """
You are a helpful home assistant with access to different devices through function calling. 
Your name is Charlie. Keep your answer to user short, concise and optimize for text to speech. 
For user answer do not use any format character like ** since it is not text to speech friendly. 
If you find what the user ask for then avoid asking for confirmation and do it.
"""

def load_agent_id():
    agent_id = None
    version = 1

    if os.path.exists(AGENT_FILE):
       with open(AGENT_FILE, "r") as f:
            data = json.load(f)
            agent_id = data.get("agent_id", None)
            version = data.get("version", 1)

    if agent_id is None:
        logger.info(f"Creating new agent for mistral AI")
        created = client.beta.agents.create(
            name="charlie-agent",
            instructions=CUSTOM_PROMPT,
            model="mistral-large-latest"
        )
        agent_id = created.id

    if agent_id is not None and version < AGENT_VERSION:
        logger.info(f"Agent require update to new version")
        client.beta.agents.update(
            agent_id=agent_id, 
            instructions=CUSTOM_PROMPT
        )

    with open(AGENT_FILE, "w") as f:
        json.dump({"agent_id": agent_id, "version": AGENT_VERSION}, f)

    logger.info(f"Use agent id {agent_id}")
    
    return agent_id
        
agent_id = load_agent_id()

@router.post("/ask")
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
