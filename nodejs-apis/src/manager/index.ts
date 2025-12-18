import devices from './devices';
import rooms from './rooms';
import providers from './providers';
import routines from './routines';
import tools from './tools';
import musics from '../musics/api';
import assistant from '../ai/api';

export default {
    ...assistant,
    ...devices,
    ...rooms,
    ...providers,
    ...routines,
    ...tools,
    ...musics,
};
