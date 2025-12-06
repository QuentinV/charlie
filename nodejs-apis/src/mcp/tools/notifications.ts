import { Tools } from '../../types';
import { z } from 'zod';
import { sendPushNotifcation } from '../../core/notifications';

const tools: Tools = {
    'send-notification': {
        description:
            'Send direct notification to user. Could be use to notify of any alert or urgent message.',
        inputSchema: {
            title: z.string(),
            body: z.string(),
        },
        exec: async ({ title, body }) => {
            await sendPushNotifcation({
                title,
                body,
            });
            return 'Sent';
        },
    },
};

export default tools;
