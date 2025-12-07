import devices from './devices';
import rooms from './rooms';
import providers from './providers';
import routines from './routines';
import tools from './tools';
import musics from '../musics/api';

export default {
    ...devices,
    ...rooms,
    ...providers,
    ...routines,
    ...tools,
    ...musics,
};
