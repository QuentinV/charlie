import React from 'react';

/**
 * Hook that detects a long press (press-hold-release) on an element.
 * Works for both mouse and touch.
 *
 * @param {() => void} onLongPress  Called once when the press is held past the threshold.
 * @param {{ threshold?: number }} [options]
 * @returns {Record<'onMouseDown'|'onMouseUp'|'onMouseLeave'|'onTouchStart'|'onTouchEnd'|'onTouchCancel', (...args: any[]) => void>}
 */
export function useLongPress(onLongPress, { threshold = 500 } = {}) {
    /** @type {React.MutableRefObject<ReturnType<typeof setTimeout> | null>} */
    const timerRef = React.useRef(null);
    const callbackRef = React.useRef(onLongPress);

    React.useEffect(() => {
        callbackRef.current = onLongPress;
    }, [onLongPress]);

    const start = () => {
        clearTimer();
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            callbackRef.current?.();
        }, threshold);
    };

    const clearTimer = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    React.useEffect(() => clearTimer, []);

    return {
        onMouseDown: (e) => {
            e.preventDefault();
            start();
        },
        onMouseUp: clearTimer,
        onMouseLeave: clearTimer,
        onTouchStart: (e) => {
            // Prevent the long-press context menu on touch
            e.preventDefault();
            start();
        },
        onTouchEnd: clearTimer,
        onTouchCancel: clearTimer,
    };
}
