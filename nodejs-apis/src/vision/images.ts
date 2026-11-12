/**
 * Image bytes of a scan, on disk.
 *
 * Mongo holds the metadata (id, mime, hash, size) and the extracted data only: a
 * phone photo is megabytes, and base64 inside a document would inflate it
 * against the 16 MB limit. The directory rotates like the echo recordings
 * (`echo/logs.ts`) — the oldest images beyond the configured count go away, so a
 * household that scans for years cannot fill the volume.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { VisionImageRef } from '../types';

/** Where scan images are written (a mounted volume in the container). */
export function imagesDir(): string {
    return process.env.VISION_IMAGES_DIR ?? 'vision/scans';
}

/** Mime types the vision model reads, with the extension each gets on disk. */
const KNOWN_MIME: { [mime: string]: string } = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

/** Normalized mime type (`image/jpg` → `image/jpeg`), undefined when unknown. */
export function normalizedImageMime(mime?: string | null): string | undefined {
    const lower = (mime ?? '').split(';')[0].trim().toLowerCase();
    const normalized = lower === 'image/jpg' ? 'image/jpeg' : lower;
    return KNOWN_MIME[normalized] ? normalized : undefined;
}

/** sha256 of the bytes: the identity of the image itself. */
export function imageHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Full path of a stored image (never escapes the images directory). */
export function imagePath(file: string): string {
    return path.join(imagesDir(), path.basename(file));
}

function ensureDir(): void {
    const dir = imagesDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/** Write the bytes of a scan to disk. */
export function saveImage(
    id: string,
    buffer: Buffer,
    mime: string
): VisionImageRef {
    ensureDir();
    const file = `${id}.${KNOWN_MIME[mime] ?? 'jpg'}`;
    fs.writeFileSync(imagePath(file), buffer);
    return { file, mime, bytes: buffer.length, hash: imageHash(buffer) };
}

/**
 * The stored bytes, undefined when the file is gone — a rotated image is a
 * documented state, not an error: the scan keeps its extracted data.
 */
export function readImage(ref: VisionImageRef): Buffer | undefined {
    try {
        return fs.readFileSync(imagePath(ref.file));
    } catch {
        return undefined;
    }
}

/** The image as a data URL, the shape the model's `image_url` expects. */
export function dataUrl(ref: VisionImageRef): string | undefined {
    const bytes = readImage(ref);
    return bytes ? `data:${ref.mime};base64,${bytes.toString('base64')}` : undefined;
}

/** Remove the image of a deleted scan (best effort). */
export function deleteImage(ref: VisionImageRef): void {
    try {
        fs.unlinkSync(imagePath(ref.file));
    } catch {
        // already rotated away
    }
}

/**
 * Keep at most `keep` images, the oldest first out. `keep <= 0` disables the
 * rotation. Returns the number of files removed.
 */
export function rotateImages(keep: number): number {
    const dir = imagesDir();
    if (!(keep > 0) || !fs.existsSync(dir)) return 0;

    const files = fs.readdirSync(dir);
    if (files.length <= keep) return 0;

    const oldest = files
        .map((file) => {
            const full = imagePath(file);
            return { full, created: fs.statSync(full).ctimeMs };
        })
        .sort((a, b) => a.created - b.created)
        .slice(0, files.length - keep);

    let removed = 0;
    for (const file of oldest) {
        try {
            fs.unlinkSync(file.full);
            removed++;
        } catch {
            // a file that disappeared meanwhile is already rotated
        }
    }
    return removed;
}
