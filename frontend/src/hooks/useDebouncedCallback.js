import React from 'react';

/**
 * Debounce a callback: the returned function forwards the arguments of the
 * *last* call to `callback` only after `delayMs` of inactivity. A pending
 * invocation is cancelled if the component unmounts or `delayMs` changes.
 *
 * @template {(...args: any[]) => void} T
 * @param {T} callback The callback to debounce.
 * @param {number} [delayMs=400] Inactivity window in milliseconds.
 * @returns {T}
 */
export function useDebouncedCallback(callback, delayMs = 400) {
    /** @type {React.MutableRefObject<ReturnType<typeof setTimeout> | null>} */
    const timerRef = React.useRef(null);
    const callbackRef = React.useRef(callback);

    React.useEffect(() => {
        callbackRef.current = callback;
    }, [callback]);

    const clearTimer = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    React.useEffect(() => clearTimer, []);

    return React.useCallback((...args) => {
        clearTimer();
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            callbackRef.current?.(...args);
        }, delayMs);
    }, [delayMs]);
}

export default useDebouncedCallback;