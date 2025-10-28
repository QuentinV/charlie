import { NotFoundError } from '../errors';
import tools from '../mcp/tools';
import { RestApis } from '../types';

const routes: RestApis = {
    tools: {
        get: async () => {
            return Object.entries(await tools()).map(([key, tool]) => ({
                key,
                description: tool.description,
                inputSchema: tool.inputSchema,
            }));
        },
    },
    'tools/:key': {
        put: {
            handler: async ({ params, body }) => {
                const tool = (await tools())[params.key];
                if (!tool) throw new NotFoundError();
                return {
                    res: await tool.exec(body),
                };
            },
            description: 'Call a tool manually',
        },
    },
};

export default routes;
