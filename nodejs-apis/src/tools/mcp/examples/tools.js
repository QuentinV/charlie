// Using registerTool (recommended)
server.registerTool(
    'my_tool',
    {
        title: 'My Tool', // This title takes precedence
        annotations: {
            title: 'Annotation Title', // This is ignored if title is set
        },
    },
    handler
);

// Using tool with annotations (older API)
server.tool(
    'my_tool',
    'description',
    {
        title: 'Annotation Title', // This is used as title
    },
    handler
);

// Simple tool with parameters
server.registerTool(
    'calculate-bmi',
    {
        title: 'BMI Calculator',
        description: 'Calculate Body Mass Index',
        inputSchema: {
            weightKg: z.number(),
            heightM: z.number(),
        },
    },
    async ({ weightKg, heightM }) => ({
        content: [
            {
                type: 'text',
                text: String(weightKg / (heightM * heightM)),
            },
        ],
    })
);

// Async tool with external API call
server.registerTool(
    'fetch-weather',
    {
        title: 'Weather Fetcher',
        description: 'Get weather data for a city',
        inputSchema: { city: z.string() },
    },
    async ({ city }) => {
        const response = await fetch(`https://api.weather.com/${city}`);
        const data = await response.text();
        return {
            content: [{ type: 'text', text: data }],
        };
    }
);

// Tool that returns ResourceLinks
server.registerTool(
    'list-files',
    {
        title: 'List Files',
        description: 'List project files',
        inputSchema: { pattern: z.string() },
    },
    async ({ pattern }) => ({
        content: [
            { type: 'text', text: `Found files matching "${pattern}":` },
            // ResourceLinks let tools return references without file content
            {
                type: 'resource_link',
                uri: 'file:///project/README.md',
                name: 'README.md',
                mimeType: 'text/markdown',
                description: 'A README file',
            },
            {
                type: 'resource_link',
                uri: 'file:///project/src/index.ts',
                name: 'index.ts',
                mimeType: 'text/typescript',
                description: 'An index file',
            },
        ],
    })
);

/*
ResourceLinks
Tools can return ResourceLink objects to reference resources without embedding their full content. 
This is essential for performance when dealing with large files or many resources - clients can then selectively read only the resources they need using the provided URIs.
*/

// Client
import { getDisplayName } from '@modelcontextprotocol/sdk/shared/metadataUtils.js';

// Automatically handles the precedence: title → annotations.title → name
const displayName = getDisplayName(tool);

// Sampling

// Tool that uses LLM sampling to summarize any text
mcpServer.registerTool(
    'summarize',
    {
        description: 'Summarize any text using an LLM',
        inputSchema: {
            text: z.string().describe('Text to summarize'),
        },
    },
    async ({ text }) => {
        // Call the LLM through MCP sampling
        const response = await mcpServer.server.createMessage({
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `Please summarize the following text concisely:\n\n${text}`,
                    },
                },
            ],
            maxTokens: 500,
        });

        return {
            content: [
                {
                    type: 'text',
                    text:
                        response.content.type === 'text'
                            ? response.content.text
                            : 'Unable to generate summary',
                },
            ],
        };
    }
);
