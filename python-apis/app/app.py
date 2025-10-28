
import os
from fastapi import FastAPI, Request
from mistralai import Mistral
from mistralai.extra.run.context import RunContext
from mcp import StdioServerParameters
from mistralai.extra.mcp.stdio import MCPClientSTDIO
from mistralai.extra.mcp.sse import MCPClientSSE, SSEServerParams
import logging

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
        
# piper_ws_server.py
#import asyncio, websockets, json
#from piper import PiperVoice

#voice = PiperVoice.load("en_US-amy-low.onnx", config_path="en_US-amy-low.onnx.json")

#async def handler(ws):
#    async for message in ws:
#        data = json.loads(message)
#        text = data.get("text", "")
#        audio = voice.synthesize(text)
#        await ws.send(audio.tobytes())  # or base64 if needed

#async def main():
#    async with websockets.serve(handler, "0.0.0.0", 8765):
#        await asyncio.Future()

#asyncio.run(main())
