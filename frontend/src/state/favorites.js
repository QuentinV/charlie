import { createEvent, createStore } from 'effector';

const STORAGE_KEY = 'charlie.favorites.devices';

/** @type {string[]} */
let initialFavorites = [];
if (typeof window !== 'undefined') {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                initialFavorites = parsed.filter(
                    (id) => typeof id === 'string'
                );
            }
        }
    } catch (e) {
        console.warn('Unable to read favorites from localStorage', e);
    }
}

/**
 * Toggles a device id in/out of favorites.
 * @type {import('effector').EventCallable<string>}
 */
export const toggleFavorite = createEvent();

export const $favoriteDeviceIds = createStore(initialFavorites);

$favoriteDeviceIds.on(toggleFavorite, (ids, deviceId) =>
    ids.includes(deviceId)
        ? ids.filter((id) => id !== deviceId)
        : [...ids, deviceId]
);

// Persist to localStorage whenever favorites change
if (typeof window !== 'undefined') {
    const storageKey = STORAGE_KEY;
    $favoriteDeviceIds.watch((ids) => {
        try {
            window.localStorage.setItem(storageKey, JSON.stringify(ids));
        } catch (e) {
            console.warn('Unable to save favorites to localStorage', e);
        }
    });
}
