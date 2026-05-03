import subprocess
import sys
import os

PROTO_PATH = "/mcp-server/src"
PROTO_FILE = "grpc_api.proto"

def build_protos():
    result = subprocess.run([
        sys.executable, "-m", "grpc_tools.protoc",
        f"-I{PROTO_PATH}",
        "--python_out=.",
        "--grpc_python_out=.",
        os.path.join(PROTO_PATH, PROTO_FILE)
    ], capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Error: {result.stderr}")
    else:
        print("Successfully generated gRPC stubs.")