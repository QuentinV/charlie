import webpush from 'web-push';
import { createTransport } from 'nodemailer';

const hasConfig =
    process.env.WEBPUSH_VAPID_PUBLICKEY && process.env.WEBPUSH_VAPID_PRIVATEKEY;

const emailTransporter = createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_NOTIFICATION_USER,
        pass: process.env.EMAIL_NOTIFICATION_PASSWORD,
    },
});

let subscriptions: PushSubscription[] = [];

export function registerNotificationApi(app: any) {
    if (!hasConfig) {
        return;
    }

    webpush.setVapidDetails(
        `mailto:${process.env.WEBPUSH_VAPID_EMAIL}`,
        process.env.WEBPUSH_VAPID_PUBLICKEY,
        process.env.WEBPUSH_VAPID_PRIVATEKEY
    );

    // Save subscription
    app.post(`/api/notifications/subscribe`, (req: any, res: any) => {
        const subscription: PushSubscription = req.body;

        const exists = subscriptions.some(
            (sub) => sub.endpoint === subscription.endpoint
        );

        if (!exists) {
            subscriptions.push(subscription);
            console.log(
                `Successfully added new subscription. Total count: ${subscriptions.length}`
            );
        } else {
            console.log(
                'Subscription already exists, skipping duplicate addition.'
            );
        }

        res.status(201).json({});
    });

    // Send notification
    app.post(`/api/notifications`, async (req: any, res: any) => {
        const { title, body } = req.body;
        const payload = JSON.stringify({ title, body });

        try {
            await Promise.all(
                subscriptions.map(async (sub) => {
                    try {
                        await webpush.sendNotification(sub, payload);
                    } catch (err: any) {
                        // If the browser service provider says the subscription expired/unsubscribed (410 or 404)
                        if (err.statusCode === 410 || err.statusCode === 404) {
                            console.log(
                                `Subscription expired or removed by browser vendor. Removing from server.`
                            );
                            subscriptions = subscriptions.filter(
                                (s) => s.endpoint !== sub.endpoint
                            );
                        } else {
                            console.error(
                                `Failed to send notification to ${sub.endpoint}:`,
                                err
                            );
                        }
                    }
                })
            );
            res.json({ success: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Notification failed' });
        }
    });
}

export interface Notification {
    title: string;
    body: string;
}

export async function sendPushNotifcation(notification: Notification) {
    if (!hasConfig) {
        return;
    }
    const payload = JSON.stringify(notification);
    try {
        return Promise.all(
            subscriptions.map((sub) => webpush.sendNotification(sub, payload))
        );
    } catch (err) {
        console.error(err);
    }
}

export async function sendEmailNotification(notification: Notification) {
    if (
        !process.env.EMAIL_NOTIFICATION_EMAIL ||
        !process.env.EMAIL_NOTIFICATION_USER ||
        !process.env.EMAIL_NOTIFICATION_TARGET_EMAIL ||
        !process.env.EMAIL_NOTIFICATION_PASSWORD
    ) {
        return;
    }
    const html = notification.body.replace(/(\n|\\n)/g, '<br/>');
    await emailTransporter.sendMail({
        from: `"Charlie Assistant" <${process.env.EMAIL_NOTIFICATION_EMAIL}>`,
        to: process.env.EMAIL_NOTIFICATION_TARGET_EMAIL,
        subject: notification.title,
        html,
    });
}
