import React, { useEffect, useState } from 'react';
import { Slider } from '@mui/material';
import { useDebouncedCallback } from '../../hooks/useDebouncedCallback';

/**
 * MUI Slider with a visual "draft" + debounced commit.
 *
 * MUI Slider is fully controlled when a `value` prop is passed: without an
 * `onChange` handler that updates it, the thumb cannot follow the pointer
 * while dragging (it looks "stuck"). This wrapper keeps a transient `draft`
 * value updated by `onChange` so the thumb always tracks the drag, then calls
 * `onChangeCommitted` once the user releases and stays idle for `debounceMs`.
 * When the external `value` changes (e.g. server state refresh), the draft is
 * re-synced so the thumb snaps to the new source of truth.
 *
 * @param {number} value Current committed value (from the server/state).
 * @param {(next: number) => void} [onChangeCommitted] Debounced commit callback.
 * @param {number} [debounceMs] Inactivity window before the commit fires.
 */
export const DebouncedSlider = ({
    value,
    onChangeCommitted,
    debounceMs = 400,
    ...props
}) => {
    const [draft, setDraft] = useState(value);
    const commit = useDebouncedCallback(onChangeCommitted, debounceMs);

    // Follow external (server) value changes; snaps the thumb to the new truth.
    useEffect(() => {
        setDraft(value);
    }, [value]);

    return (
        <Slider
            {...props}
            value={draft}
            onChange={(event, next) => setDraft(next)}
            onChangeCommitted={(event, next) => {
                setDraft(next);
                commit(next);
            }}
        />
    );
};

export default DebouncedSlider;