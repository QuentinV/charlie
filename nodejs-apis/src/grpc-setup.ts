import {
    GrpcObject,
    Server,
    loadPackageDefinition,
    ServerCredentials,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import mcpRoutes from './tools/mcp/api.grpc';

const services = {
    ...mcpRoutes,
};

const GRPC_PORT = '9308';
const defaultPackage = 'api';

export async function setupGrpcServer() {
    const server = new Server();

    const packageDef = loadSync('./src/grpc_api.proto', {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
    });
    const mcpProto = loadPackageDefinition(packageDef);
    const rootObj = mcpProto[defaultPackage];

    Object.entries(services ?? {}).forEach(([name, fnts]) => {
        server.addService(
            rootObj[name].service,
            Object.entries(fnts).reduce((prev, [key, fnt]) => {
                prev[key] = async (call, callback) => {
                    const res: any = {};
                    try {
                        const result = await fnt(call);
                        res.resultJson = JSON.stringify(result);
                    } catch (e) {
                        res.isError = true;
                    }
                    callback(null, res);
                };
                return prev;
            }, {})
        );
    });

    /*
    server.addService(mcpProto.MCPService.service, {
        CallTool: (call, callback) => {
            const { toolName, argumentsJson } = call.request;
            // Execute your Node.js device logic here
            console.log(`LLM requested tool: ${toolName}`);

            callback(null, {
                resultJson: '{"status": "success"}',
                isError: false,
            });
        },
    });*/

    server.bindAsync(
        `0.0.0.0:${GRPC_PORT}`,
        ServerCredentials.createInsecure(),
        () => {
            console.log(`GRPC Server running on port ${GRPC_PORT}`);
        }
    );
}
