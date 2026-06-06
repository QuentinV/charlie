self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    const data = event.data?.json?.() || {};
    const title = data.title || 'Notification';
    const body = data.body || '';
    const icon = data.icon || '/icon.png';

    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon,
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients
            .matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                if (clientList.length > 0) {
                    return clientList[0].focus();
                }
                return self.clients.openWindow('/');
            })
    );
});
