import devices from './devices';
import rooms from './rooms';
import providers from './providers';
import routines from './routines';
import assistant from '../ai/api';
import echo from '../echo/api';
import activities from './activities';
import settings from './settings';

export default {
    ...assistant,
    ...devices,
    ...rooms,
    ...activities,
    ...providers,
    ...routines,
    ...echo,
    ...settings,
};
