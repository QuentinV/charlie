import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { setPwaPrompt } from './state/standalone';

createRoot(document.getElementById('root')).render(<App />);

if (
    !window?.navigator?.standalone &&
    !window?.matchMedia('(display-mode: standalone)')?.matches
) {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        setPwaPrompt(e);
    });
}

// Web-push registration lives in api/push.js: it must wait until the app is
// usable, because the subscribe endpoint is behind the auth gate.

