/**
 * Images on disk: mime normalization, hashing, writing/reading, rotation. The
 * directory comes from `VISION_IMAGES_DIR`, which the tests point at a temp dir.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    dataUrl,
    deleteImage,
    imageHash,
    imagePath,
    normalizedImageMime,
    readImage,
    rotateImages,
    saveImage,
} from '../images';

const dir = path.join(os.tmpdir(), `charlie-vision-${process.pid}`);

beforeAll(() => {
    process.env.VISION_IMAGES_DIR = dir;
    fs.rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.VISION_IMAGES_DIR;
});

beforeEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('mime handling', () => {
    test('normalizes what browsers and curl send', () => {
        expect(normalizedImageMime('image/jpeg')).toBe('image/jpeg');
        expect(normalizedImageMime('image/jpg')).toBe('image/jpeg');
        expect(normalizedImageMime('IMAGE/PNG; charset=binary')).toBe('image/png');
        expect(normalizedImageMime('image/webp')).toBe('image/webp');
        // Anything the vision model cannot read is refused rather than stored.
        expect(normalizedImageMime('application/pdf')).toBeUndefined();
        expect(normalizedImageMime(undefined)).toBeUndefined();
    });
});

describe('storage', () => {
    test('writes the bytes, hashes them and reads them back', () => {
        const bytes = Buffer.from('un jpeg de test');
        const ref = saveImage('scan-1', bytes, 'image/jpeg');

        expect(ref).toEqual({
            file: 'scan-1.jpg',
            mime: 'image/jpeg',
            bytes: bytes.length,
            hash: imageHash(bytes),
        });
        expect(fs.existsSync(imagePath(ref.file))).toBe(true);
        expect(readImage(ref)).toEqual(bytes);
        // What the model receives: the same bytes as a data URL.
        expect(dataUrl(ref)).toBe(
            `data:image/jpeg;base64,${bytes.toString('base64')}`
        );
    });

    test('a rotated-away image is a documented absence, not a crash', () => {
        const ref = saveImage('scan-2', Buffer.from('png'), 'image/png');
        deleteImage(ref);
        expect(readImage(ref)).toBeUndefined();
        expect(dataUrl(ref)).toBeUndefined();
        // Deleting twice is not an error either.
        expect(() => deleteImage(ref)).not.toThrow();
    });

    test('keeps the newest images and drops the oldest ones', () => {
        for (const name of ['a', 'b', 'c', 'd']) {
            saveImage(name, Buffer.from(name), 'image/jpeg');
        }
        expect(rotateImages(2)).toBe(2);
        expect(fs.readdirSync(dir).sort()).toEqual(['c.jpg', 'd.jpg']);
        // Nothing to do when the count is already respected (or disabled).
        expect(rotateImages(2)).toBe(0);
        expect(rotateImages(0)).toBe(0);
    });

    test('never lets a file name escape the images directory', () => {
        expect(imagePath('../../etc/passwd')).toBe(
            path.join(dir, 'passwd')
        );
    });
});
