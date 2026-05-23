import { cs } from '../../core/db';
import { ToolPlugin, Tools, ToolsExecutors, ToolsSchema } from '../../types';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { getProvidersTools } from '../../devices';
import { createPluginSchema, createPluginExecutor } from './impl/plugin';
import weather from './impl/weather';
import devices from './impl/devices';
import notifications from './impl/notifications';
import music from './impl/music';

let CACHE_SCHEMAS: ToolsSchema | null = null;
let CACHE_TOOLS_EXEC: ToolsExecutors | null = null;

export function createToolsSchemas(tools: Tools): ToolsSchema {
    return Object.entries(tools)
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

export async function toolsSchemas(): Promise<ToolsSchema> {
    if (!CACHE_SCHEMAS) {
        const plugins = await cs.plugins.find({ type: 'tools' }).toArray();

        const defaultTools = {
            ...(process.env.TOOL_NOTIFICATION === 'true' ? notifications : {}),
            ...weather,
            ...(process.env.TOOL_MUSIC === 'true' ? music : {}),
            ...(await devices()),
            ...(await getProvidersTools()),
        };

        const pluginsTools = (
            await Promise.allSettled(
                plugins.map(async (tp: ToolPlugin) => ({
                    plugin: tp,
                    schema: await createPluginSchema(tp),
                }))
            )
        ).flatMap((r: any) => r.value);

        CACHE_TOOLS_EXEC = {
            ...defaultTools,
            ...pluginsTools.reduce((prev, tool) => {
                Object.entries(
                    createPluginExecutor(tool.plugin, tool.schema)
                ).forEach(([k, v]) => (prev[k] = v));
                return prev;
            }, {}),
        };

        CACHE_SCHEMAS = [
            ...createToolsSchemas(defaultTools),
            ...pluginsTools.map((t) => t.schema),
        ];
    }

    return CACHE_SCHEMAS!;
}

export function toolsExecutors() {
    return CACHE_TOOLS_EXEC!;
}
