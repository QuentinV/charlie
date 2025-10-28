import devices from './devices';
import rooms from './rooms';
import providers from './providers';
import routines from './routines';
import tools from './tools';

export default {
    ...devices,
    ...rooms,
    ...providers,
    ...routines,
    ...tools,
};
