/**
 * Keyframes on disk: the single frame attached to an escalated event.
 *
 * Mirrors `vision/images.ts`: Mongo keeps only the metadata, the bytes live on
 * disk and the directory rotates so a house that watches for years cannot fill
 * the volume. **No continuous video is ever written** — one JPEG per event.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/** Where keyframes are written (a mounted volume in the container). */
export function keyframesDir(): string {
    return process.env.VISION_KEYFRAMES_DIR ?? 'vision/keyframes';
}

function ensureDir(): void {
    const dir = keyframesDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Full path of a keyframe (never escapes the keyframes directory). */
export function keyframePath(file: string): string {
    return path.join(keyframesDir(), path.basename(file));
}

/** A stable id for the bytes: the same frame stored twice is the same file. */
export function keyframeId(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 24);
}

/** Write one JPEG keyframe; returns its file name. */
export function saveKeyframe(id: string, buffer: Buffer): string {
    ensureDir();
    const file = `${id}.jpg`;
    fs.writeFileSync(keyframePath(file), buffer);
    return file;
}

/** Read a keyframe's bytes, undefined when it was rotated away. */
export function readKeyframe(file: string): Buffer | undefined {
    try {
        return fs.readFileSync(keyframePath(file));
    } catch {
        return undefined;
    }
}

/**
 * Keep at most `keep` keyframes, the oldest first out. `keep <= 0` disables the
 * rotation. Returns the number of files removed.
 */
export function rotateKeyframes(keep: number): number {
    const dir = keyframesDir();
    if (!(keep > 0) || !fs.existsSync(dir)) return 0;

    const files = fs.readdirSync(dir);
    if (files.length <= keep) return 0;

    const oldest = files
        .map((file) => {
            const full = keyframePath(file);
            return { full, created: fs.statSync(full).ctimeMs };
        })
        .sort((a, b) => a.created - b.created)
        .slice(0, files.length - keep);

    let removed = 0;
    for (const entry of oldest) {
        try {
            fs.unlinkSync(entry.full);
            removed++;
        } catch {
            // a file that disappeared meanwhile is already rotated
        }
    }
    return removed;
}
