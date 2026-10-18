import { sendPushNotifcation } from '../core/notifications';
import { RestApis } from '../types';

const routes: RestApis = {
    notifications: {
        post: {
            handler: async ({ body }) => {
                if (body?.type === 'push') {
                    await sendPushNotifcation(body);
                }
            },
            description: 'Send notification',
        },
    },
};

export default routes;
