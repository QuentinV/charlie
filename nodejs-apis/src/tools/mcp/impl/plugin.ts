import {
    ToolPlugin,
    ToolSchema,
    ToolsExecutors,
    ToolsSchema,
} from '../../../types';

export async function createPluginSchema(
    plugin: ToolPlugin
): Promise<ToolsSchema> {
    const res = await fetch(`http://${plugin.host}/tools`);
    return res.json();
}

export function createPluginExecutor(plugin: ToolPlugin, schemas: ToolsSchema) {
    return schemas.reduce((prev: ToolsExecutors, schema: ToolSchema) => {
        if (!schema.function?.name) return prev;
        const name = schema.function.name;
        prev[name] = {
            exec: async (params: any): Promise<string | void | boolean> => {
                try {
                    const res = await fetch(
                        `http://${plugin.host}/tools/${name}`,
                        {
                            method: 'POST',
                            body: JSON.stringify(params),
                        }
                    );
                    const json = await res.json();
                    if (typeof json.success === 'boolean') {
                        return json.success;
                    }
                    return JSON.stringify(json);
                } catch (e) {
                    return 'an error occured';
                }
            },
        };
        return prev;
    }, {} as ToolsExecutors);
}
