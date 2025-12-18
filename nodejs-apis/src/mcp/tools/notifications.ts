import { Tools } from '../../types';
import { z } from 'zod';
import {
    sendEmailNotification,
    sendPushNotifcation,
} from '../../core/notifications';

const tools: Tools = {
    'send-notification': {
        description:
            'Send notification to user. Could be used to notify of any alert, urgent message or if asked directly by user.',
        inputSchema: {
            title: z.string(),
            body: z.string(),
            type: z.enum(['push', 'email']),
        },
        exec: async ({ title, body, type }) => {
            if (type === 'email') {
                await sendEmailNotification({ title, body });
            } else {
                await sendPushNotifcation({
                    title,
                    body,
                });
            }
            return 'Sent';
        },
    },
};

export default tools;
