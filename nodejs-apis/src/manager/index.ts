import devices from './devices';
import rooms from './rooms';
import providers from './providers';
import routines from './routines';
import tools from './tools';
import musics from '../musics/api';
import assistant from '../ai/api';
import activities from './activities';

export default {
    ...assistant,
    ...devices,
    ...rooms,
    ...activities,
    ...providers,
    ...routines,
    ...tools,
    ...(process.env.TOOL_MUSIC === 'true' ? musics : {}),
};
