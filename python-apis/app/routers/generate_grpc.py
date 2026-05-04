import subprocess
import sys
import os

def build_protos():
    result = subprocess.run([
        sys.executable, "-m", "grpc_tools.protoc",
        f"-I/mcp-server/src",
        "--python_out=.",
        "--grpc_python_out=.",
        "/mcp-server/src/grpc_api.proto"
    ], capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Error: {result.stderr}")
    else:
        print("Successfully generated gRPC MCP tools stubs.")

    result = subprocess.run([
        sys.executable, "-m", "grpc_tools.protoc",
        f"-I.",
        "--python_out=.",
        "--grpc_python_out=.",
        "chat.proto"
    ], capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Error: {result.stderr}")
    else:
        print("Successfully generated gRPC AI Chat stubs.")