import tools from '.';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

export async function buildMcpServer(app: any) {
    const server = new McpServer(
        {
            name: 'charlie-mcp-server',
            version: '1.0.0',
        },
        {
            debouncedNotificationMethods: ['notifications/tools/list_changed'],
        }
    );

    const setupServer = async (server: any) => {
        Object.entries(await tools()).forEach(([k, c]) => {
            if (!c?.description || !c?.exec) {
                console.error('Missing def or exec for mcp tool', k, c);
                return;
            }
            console.log(`[MCP Tools][${k}] ${c.description}`);
            const tool = server.registerTool(
                k,
                {
                    description: c.description,
                    inputSchema: c.inputSchema,
                },
                async (params: any) => {
                    try {
                        console.log(
                            `[MCP Tools] calling ${k} with ${JSON.stringify(
                                params
                            )}`
                        );
                        const res = await c.exec(params);
                        if (res === true || res === false) {
                            return {
                                content: [
                                    {
                                        type: 'text',
                                        text: res ? 'Success' : 'Failed',
                                    },
                                ],
                            };
                        } else if (res) {
                            return {
                                content: [
                                    {
                                        type: 'text',
                                        text: res,
                                    },
                                ],
                            };
                        }
                    } catch (e) {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `An error occured.`,
                                },
                            ],
                        };
                    }
                }
            );
            if (c.disabled) {
                tool.disable();
            }
        });
    };

    server.tool('noop', {
        description: 'No-op tool for compatibility',
        parameters: {
            type: 'object',
            properties: {},
        },
        execute: async () => {
            return 'noop';
        },
    });

    await setupServer(server);

    // Store transports for each session type
    const transports: any = {
        streamable: {},
        sse: {},
    };

    // Legacy SSE endpoint for older clients
    app.get('/sse', async (_req: any, res: any) => {
        console.log('GET sse');
        // Create SSE transport for legacy clients
        const transport = new SSEServerTransport('/messages', res);
        transports.sse[transport.sessionId] = transport;

        res.on('close', () => {
            delete transports.sse[transport.sessionId];
        });

        await server.connect(transport);
    });

    // Legacy message endpoint for older clients
    app.post('/messages', async (req: any, res: any) => {
        const sessionId = req.query.sessionId;
        const transport = transports.sse[sessionId];
        if (transport) {
            await transport.handlePostMessage(req, res, req.body);
        } else {
            res.status(400).send('No transport found for sessionId');
        }
    });
}
