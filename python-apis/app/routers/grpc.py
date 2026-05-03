import os
import grpc
import grpc_api_pb2
import grpc_api_pb2_grpc

host = os.getenv("TOOL_HOST")

# Create a persistent channel
channel = grpc.insecure_channel(host + ":9308")
stub = grpc_api_pb2_grpc.MCPServiceStub(channel)

response = stub.CallTool(grpc_api_pb2.ToolRequest(
    toolName="turn_on_light",
    argumentsJson='{"id": "kitchen_1"}'
))

print(f"Tool Result: {response.resultJson}")
