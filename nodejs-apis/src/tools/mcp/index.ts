import { Tools } from '../../types';
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

// TODO tool plugin - register save db as provider but type = 'tool'
