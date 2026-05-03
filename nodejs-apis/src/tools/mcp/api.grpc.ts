import { GrpcApi } from '../../types';

const routes: GrpcApi = {
    MCPService: {
        CallTool: async (call) => {
            const { toolName, argumentsJson } = call.request;
            console.log(`LLM requested tool: ${toolName}`);

            return { status: 'success' };
        },
    },
};

export default routes;
