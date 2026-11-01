import { api } from './charlie';

let started = false;

/**
 * Register the service worker and the web-push subscription.
 *
 * Called once the app is usable (protection off, or the user is signed in):
 * `/api/notifications/subscribe` is behind the auth gate, so subscribing
 * before login would just return 401.
 */
export async function subscribePush() {
    if (started) return;

    const publicKey = import.meta.env.VITE_WEBPUSH_VAPID_PUBLICKEY;
    if (!publicKey) {
        console.log(
            'VITE_WEBPUSH_VAPID_PUBLICKEY is not configured, cannot receive push notification from server'
        );
        return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    started = true;

    try {
        await navigator.serviceWorker.register('/sw.js');
        const reg = await navigator.serviceWorker.ready;

        if (Notification.permission === 'default') {
            await Notification.requestPermission();
        }
        if (Notification.permission !== 'granted') {
            // Let a later login / page visit retry the prompt.
            started = false;
            return;
        }

        const subscription =
            (await reg.pushManager.getSubscription()) ??
            (await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: publicKey,
            }));

        await api('notifications/subscribe', {
            method: 'POST',
            body: JSON.stringify(subscription),
        });
    } catch (error) {
        started = false;
        console.error('Push subscription failed:', error);
    }
}
