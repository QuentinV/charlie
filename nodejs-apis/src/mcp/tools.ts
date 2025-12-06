import { Tools } from '../types';
import { getProvidersTools } from '../devices';
import greetings from './tools/greetings';
import weather from './tools/weather';
import devices from './tools/devices';
import torrent from './tools/torrent';
import notifications from './tools/notifications';

const tools = async (): Promise<Tools> => ({
    ...greetings,
    ...notifications,
    ...weather,
    ...torrent,
    ...(await devices()),
    ...(await getProvidersTools()),
});

export default tools;
