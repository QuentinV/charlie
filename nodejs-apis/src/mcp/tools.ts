import greetings from './tools/greetings';
import weather from './tools/weather';
import devices from './tools/devices';
import torrent from './tools/torrent';
import { Tools } from '../types';
import { getProvidersTools } from '../devices';

const tools = async (): Promise<Tools> => ({
    ...greetings,
    ...weather,
    ...torrent,
    ...(await devices()),
    ...(await getProvidersTools()),
});

export default tools;
