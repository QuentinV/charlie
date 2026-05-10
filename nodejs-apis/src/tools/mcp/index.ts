import { Tools } from '../../types';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { getProvidersTools } from '../../devices';
import greetings from './impl/greetings';
import weather from './impl/weather';
import devices from './impl/devices';
import torrent from './impl/torrent';
import notifications from './impl/notifications';
import music from './impl/music';

const tools = async (): Promise<Tools> => ({
    ...greetings,
    ...(process.env.TOOL_NOTIFICATION === 'true' ? notifications : {}),
    ...weather,
    ...(process.env.TOOL_MUSIC === 'true' ? music : {}),
    ...(process.env.TOOL_TORRENT === 'true' ? torrent : {}),
    ...(await devices()),
    ...(await getProvidersTools()),
});

let toolsCache: Tools | null = null;

export async function initTools() {
    toolsCache = await tools();
}

export async function getTools(): Promise<Tools> {
    return toolsCache!;
}

interface ToolsSchema {
    type: string;
    function?: {
        name: string;
        description: string;
        parameters: any;
    };
}

export async function getToolsSchemas(): Promise<ToolsSchema[]> {
    return Object.entries(await getTools())
        .map(([k, t]) => {
            if (!t?.description || !t?.exec) {
                console.error('Missing def or exec for mcp tool', k, t);
                return;
            }
            const { $schema, ...parameters } = zodToJsonSchema(
                z.object(t.inputSchema)
            );
            return {
                type: 'function',
                function: {
                    name: k,
                    description: t.description,
                    parameters,
                },
            };
        })
        .filter((t) => !!t);
}

// TODO tool plugin - register save db as provider but type = 'tool'
