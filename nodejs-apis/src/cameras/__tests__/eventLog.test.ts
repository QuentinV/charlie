/**
 * The in-memory ring behind the camera panel's timeline: newest first, capped by
 * count and by age. No Mongo — the module *is* the store.
 */
import { VisionEvent } from '../../types';
import {
    EVENT_MAX_AGE_MS,
    KEEP_EVENTS,
    appendEvent,
    forgetCamera,
    keyframeFile,
    listEvents,
    pruneEvents,
} from '../eventLog';

const event = (over: Partial<VisionEvent> = {}): VisionEvent => ({
    at: Date.now(),
    cameraId: 'cam-1',
    modes: ['presence'],
    kind: 'dwell',
    classes: ['person'],
    ...over,
});

const stored = (at: number, i: number): any => ({
    at,
    cameraId: 'cam-1',
    modes: ['presence'],
    kind: 'dwell' as const,
    classes: [] as string[],
    i,
});

describe('keyframeFile', () => {
    it('reads the file name out of a keyframe URL', () => {
        expect(keyframeFile('/api/vision/keyframes/abc123.jpg')).toBe(
            'abc123.jpg'
        );
    });

    it('ignores anything that is not a stored jpg', () => {
        expect(keyframeFile(undefined)).toBeUndefined();
        expect(keyframeFile('')).toBeUndefined();
        expect(keyframeFile('http://elsewhere/frame.png')).toBeUndefined();
    });
});

describe('pruneEvents', () => {
    const now = 1_000_000;

    it('drops anything older than the window', () => {
        const list = [stored(now - EVENT_MAX_AGE_MS - 1, 1), stored(now, 2)];
        expect(pruneEvents(list, now)).toHaveLength(1);
    });

    it('keeps only the last N, in order', () => {
        const list = Array.from({ length: KEEP_EVENTS + 5 }, (_, i) =>
            stored(now, i)
        );
        const kept = pruneEvents(list, now);

        expect(kept).toHaveLength(KEEP_EVENTS);
        // `i` is a test-only marker: the type knows nothing about it.
        expect((kept[kept.length - 1] as any).i).toBe(KEEP_EVENTS + 4);
    });
});

describe('the ring', () => {
    // Realistic timestamps: the ring drops anything older than its window, so
    // `at: 1` would be pruned the moment it lands.
    const base = Date.now();

    beforeEach(() => forgetCamera('cam-1'));

    it('lists the most recent events first', () => {
        appendEvent(event({ at: base }));
        appendEvent(event({ at: base + 1000 }));

        expect(listEvents('cam-1').map((e) => e.at)).toEqual([
            base + 1000,
            base,
        ]);
    });

    it('honours the limit', () => {
        for (let i = 0; i < 10; i++) appendEvent(event({ at: base + i }));

        expect(listEvents('cam-1', 3).map((e) => e.at)).toEqual([
            base + 9,
            base + 8,
            base + 7,
        ]);
    });

    it('caps the buffer per camera', () => {
        for (let i = 0; i < KEEP_EVENTS + 3; i++) {
            appendEvent(event({ at: base + i }));
        }

        expect(listEvents('cam-1', KEEP_EVENTS + 10)).toHaveLength(KEEP_EVENTS);
    });

    it('keeps the cameras apart and forgets one on demand', () => {
        appendEvent(event({ cameraId: 'cam-2' }));
        expect(listEvents('cam-1')).toEqual([]);
        expect(listEvents('cam-2')).toHaveLength(1);

        forgetCamera('cam-2');
        expect(listEvents('cam-2')).toEqual([]);
    });

    it('remembers the keyframe file of an escalated event', () => {
        appendEvent(
            event({ keyframeUrl: '/api/vision/keyframes/deadbeef.jpg' })
        );

        expect(listEvents('cam-1')[0].keyframe).toBe('deadbeef.jpg');
    });

    it('keeps the whole event (classes, dwell, vlm)', () => {
        appendEvent(
            event({
                kind: 'dwell',
                classes: ['person', 'dog'],
                dwellMs: 15000,
                vlm: { tier: 'fast', text: 'une personne devant le frigo' },
            })
        );

        const [kept] = listEvents('cam-1');
        expect(kept.classes).toEqual(['person', 'dog']);
        expect(kept.dwellMs).toBe(15000);
        expect(kept.vlm?.text).toBe('une personne devant le frigo');
    });
});
