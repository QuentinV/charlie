import { GrpcApi } from '../../types';
import { log } from '../../manager/services/activities';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { getTools } from '.';

const routes: GrpcApi = {
    MCPService: {
        /**
         * Execute any tools by name with given parameters
         */
        CallTool: async (call) => {
            const { toolName, argumentsJson } = call.request;
            console.log(`LLM requested tool: ${toolName}`);

            try {
                log('MCP Tools', `calling ${toolName}`, {
                    context: { name: toolName, params: argumentsJson },
                });

                const tool = (await getTools())?.[toolName];
                if (!tool) {
                    return { errorMessage: 'not found' };
                }

                const res = await tool?.exec(argumentsJson);

                if (res === true || res === false) {
                    return {
                        resultJson: { success: res },
                    };
                } else if (res) {
                    return {
                        resultJson: res,
                    };
                }
            } catch (e) {
                return {
                    errorMessage: `An error occured.`,
                };
            }

            return { resultJson: { success: 'unknown' } };
        },
        /**
         * @returns JSON Schema of available tools
         */
        ListTools: async () => ({
            content: Object.entries(await getTools()).map(([k, t]) => {
                if (!t?.description || !t?.exec) {
                    console.error('Missing def or exec for mcp tool', k, t);
                    return;
                }
                const { $schema, ...parameters } = zodToJsonSchema(
                    z.object(t.inputSchema)
                );
                return {
                    name: k,
                    description: t.description,
                    parameters,
                };
            }),
        }),
    },
};

export default routes;
