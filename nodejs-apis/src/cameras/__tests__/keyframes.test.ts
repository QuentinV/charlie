/**
 * Keyframes on disk: writing, reading, rotation. The directory comes from
 * `VISION_KEYFRAMES_DIR`, which the tests point at a temp dir.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    keyframeId,
    keyframePath,
    readKeyframe,
    rotateKeyframes,
    saveKeyframe,
} from '../keyframes';

const dir = path.join(os.tmpdir(), `charlie-keyframes-${process.pid}`);

beforeAll(() => {
    process.env.VISION_KEYFRAMES_DIR = dir;
    fs.rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.VISION_KEYFRAMES_DIR;
});

beforeEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('keyframes', () => {
    test('writes, reads and hashes a keyframe', () => {
        const bytes = Buffer.from('un jpeg de test');
        const id = keyframeId(bytes);
        const file = saveKeyframe(id, bytes);

        expect(file).toBe(`${id}.jpg`);
        expect(fs.existsSync(keyframePath(file))).toBe(true);
        expect(readKeyframe(file)).toEqual(bytes);
        // The same bytes hash to the same id: an idempotent keyframe.
        expect(keyframeId(bytes)).toBe(id);
    });

    test('a rotated-away keyframe is an absence, not a crash', () => {
        expect(readKeyframe('missing.jpg')).toBeUndefined();
    });

    test('keeps the newest keyframes and drops the oldest ones', () => {
        for (const name of ['a', 'b', 'c', 'd']) {
            saveKeyframe(name, Buffer.from(name));
        }
        expect(rotateKeyframes(2)).toBe(2);
        expect(fs.readdirSync(dir).sort()).toEqual(['c.jpg', 'd.jpg']);
        // Nothing to do when the count is already respected (or disabled).
        expect(rotateKeyframes(2)).toBe(0);
        expect(rotateKeyframes(0)).toBe(0);
    });

    test('never lets a file name escape the keyframes directory', () => {
        expect(keyframePath('../../etc/passwd')).toBe(
            path.join(dir, 'passwd')
        );
    });
});
