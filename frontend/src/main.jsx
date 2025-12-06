import React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);

// Push notifications
if (import.meta.env.VITE_WEBPUSH_VAPID_PUBLICKEY) {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker
            .register('/sw.js')
            .then((reg) => {
                console.log('Service Worker registered:', reg);
            })
            .catch((err) => console.error('SW registration failed:', err));
    }

    async function askPermission() {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            throw new Error('Permission not granted for Notification');
        }
    }
    askPermission();

    async function subscribeUser() {
        const reg = await navigator.serviceWorker.ready;
        const subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: import.meta.env.VITE_WEBPUSH_VAPID_PUBLICKEY,
        });

        // Send subscription to backend
        await fetch('/api/notifications/subscribe', {
            method: 'POST',
            body: JSON.stringify(subscription),
            headers: { 'Content-Type': 'application/json' },
        });
    }
    subscribeUser();
} else {
    console.log(
        'VITE_WEBPUSH_VAPID_PUBLICKEY is not configured, cannot receive push notification from server'
    );
}
