import devices from './devices';
import rooms from './rooms';
import providers from './providers';
import routines from './routines';
import assistant from '../ai/api';
import echo from '../echo/api';
import activities from './activities';
import settings from './settings';
import notifications from './notifications';
import memory from './memory';
import auth from '../auth/api';

export default {
    ...assistant,
    ...auth,
    ...devices,
    ...rooms,
    ...activities,
    ...providers,
    ...routines,
    ...echo,
    ...settings,
    ...memory,
    ...notifications,
};
