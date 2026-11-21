import devices from './devices';
import rooms from './rooms';
import providers from './providers';
import automations from './automations';
import assistant from '../ai/api';
import echo from '../echo/api';
import activities from './activities';
import settings from './settings';
import notifications from './notifications';
import memory from './memory';
import vision from '../vision/api';
import cameras from '../cameras/api';
import auth from '../auth/api';

export default {
    ...assistant,
    ...auth,
    ...devices,
    ...rooms,
    ...activities,
    ...providers,
    ...automations,
    ...echo,
    ...settings,
    ...memory,
    ...vision,
    ...cameras,
    ...notifications,
};
