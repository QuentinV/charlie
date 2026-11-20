/**
 * A standalone webcam server: the laptop's camera → MJPEG over HTTP.
 *
 * Why it exists: a USB webcam cannot be passed into a container on every host
 * (Docker Desktop on Windows has no `/dev/video0`), and `vision-feed` only needs
 * a URL. So the camera is published as an ordinary HTTP source
 * (`provider.properties.kind: 'mjpeg'`) and Charlie stays out of the device business:
 *
 *     yarn webcam                 # serves http://127.0.0.1:9312/video.mjpg
 *     yarn webcam --register      # …and creates/updates the camera device
 *
 * It imports **nothing** from the brain (no DB, no Express), so it runs next to a
 * running server, and ffmpeg does the capture (no native npm dependency). One
 * ffmpeg process feeds every connected client, and the same stream is scanned for
 * complete JPEGs so `/snapshot.jpg` answers instantly without a second process.
 */
import 'dotenv/config';
import { ChildProcess, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

// ===== pure helpers (unit-tested) =====

export type Platform = 'win32' | 'linux' | 'darwin';

export interface CaptureOptions {
    /** webcam: the device name (Windows) or index/path (`0`, `/dev/video0`). */
    device: string;
    platform?: Platform;
    fps?: number;
    /** `1280x720`; omitted = the device's own mode (dshow rejects some sizes). */
    size?: string;
    quality?: number;
}

/** What ffmpeg opens on this platform (the input half of a command line). */
export function inputArgs(
    platform: Platform,
    device: string,
    fps: number,
    size?: string
): string[] {
    if (platform === 'win32') {
        // Never force an input `-framerate` on dshow: many cameras answer
        // "Could not set video options" (verified on a Laptop Webcam Module),
        // and the output `-r` sets the served rate anyway.
        const args = ['-f', 'dshow'];
        if (size) args.push('-video_size', size);
        return [...args, '-i', `video=${device}`];
    }
    if (platform === 'darwin') {
        const args = ['-f', 'avfoundation', '-framerate', String(fps)];
        if (size) args.push('-video_size', size);
        return [...args, '-i', device || '0'];
    }
    const args = ['-f', 'v4l2'];
    if (size) args.push('-video_size', size);
    return [...args, '-framerate', String(fps), '-i', device || '/dev/video0'];
}

/** The live capture: MJPEG multipart written to stdout. */
export function buildCaptureArgs(o: CaptureOptions): string[] {
    const platform = o.platform ?? (process.platform as Platform);
    const fps = o.fps ?? 10;
    return [
        '-hide_banner',
        '-loglevel',
        'error',
        ...inputArgs(platform, o.device, fps, o.size),
        '-an',
        '-r',
        String(fps),
        '-c:v',
        'mjpeg',
        '-q:v',
        String(o.quality ?? 5),
        '-f',
        'mpjpeg',
        '-',
    ];
}

/** One frame, as a single JPEG on stdout. */
export function buildSnapshotArgs(o: CaptureOptions): string[] {
    const platform = o.platform ?? (process.platform as Platform);
    return [
        '-hide_banner',
        '-loglevel',
        'error',
        ...inputArgs(platform, o.device, o.fps ?? 10, o.size),
        '-frames:v',
        '1',
        '-c:v',
        'mjpeg',
        '-q:v',
        String(o.quality ?? 5),
        '-f',
        'image2pipe',
        '-',
    ];
}

/**
 * The video devices in `ffmpeg -list_devices true -f dshow -i dummy` output,
 * which prefixes every line with its log context (`[dshow @ 0x…] "Name" (video)`).
 * The `Alternative name "…"` lines end in no `(video)` marker and audio entries
 * end in `(audio)`, so both are excluded.
 */
export function parseDshowDevices(output: string): string[] {
    const names: string[] = [];
    for (const line of String(output ?? '').split(/\r?\n/)) {
        const match = line.match(/"([^"]+)"\s*\(video\)\s*$/);
        if (match) names.push(match[1]);
    }
    return names;
}

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

/**
 * Split an MJPEG byte stream into complete JPEGs. The tail that has no closing
 * marker yet is carried to the next chunk (a frame straddles chunks constantly),
 * so the caller only ever sees whole images.
 */
export function parseFrames(
    chunk: Buffer,
    carry: Buffer = Buffer.alloc(0)
): { frames: Buffer[]; carry: Buffer } {
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const frames: Buffer[] = [];

    let start = buf.indexOf(SOI);
    while (start !== -1) {
        const end = buf.indexOf(EOI, start + SOI.length);
        if (end === -1) break;
        frames.push(Buffer.from(buf.subarray(start, end + EOI.length)));
        start = buf.indexOf(SOI, end + EOI.length);
    }

    // Keep from the last unmatched start; with none, keep the final byte in case
    // it is the 0xff half of a marker split across two chunks.
    const from = start === -1 ? Math.max(0, buf.length - 1) : start;
    return { frames, carry: Buffer.from(buf.subarray(from)) };
}

// ===== the server =====

/** ffmpeg's mpjpeg muxer delimits parts with `--ffmpeg` (so boundary=ffmpeg). */
export const BOUNDARY = 'ffmpeg';

export interface WebcamConfig extends CaptureOptions {
    port: number;
    host: string;
    /** The host to advertise in URLs (`host.docker.internal` for a container). */
    publicHost: string;
    idleMs: number;
    always: boolean;
    ffmpeg: string;
    brainUrl: string;
    tokenFile: string;
}

/** The token the brain mints (`auth/serviceToken.ts`), env override first. */
export function readBrainToken(file: string): string {
    if (process.env.BRAIN_TOKEN) return process.env.BRAIN_TOKEN;
    try {
        return fs.readFileSync(file, 'utf8').trim();
    } catch {
        return '';
    }
}

/** The first dshow video device, or the platform's usual camera path. */
export function detectDevice(ffmpeg = 'ffmpeg'): string {
    if (process.env.WEBCAM_DEVICE) return process.env.WEBCAM_DEVICE;
    if (process.platform === 'win32') {
        const probe = spawnSync(
            ffmpeg,
            ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
            { encoding: 'utf8' }
        );
        const names = parseDshowDevices(
            `${probe.stdout ?? ''}${probe.stderr ?? ''}`
        );
        if (names.length) return names[0];
        throw new Error(
            'no dshow video device found — set WEBCAM_DEVICE to a name printed by: ffmpeg -list_devices true -f dshow -i dummy'
        );
    }
    if (process.platform === 'darwin') return '0';
    return '/dev/video0';
}

/**
 * How many whole frames a client may have queued before it is skipped.
 *
 * One frame is in flight to the socket, one may be being written; beyond that the
 * client is behind and the next frame is worth more to it than the one it missed.
 */
export const QUEUE_FRAMES = 2;

/** Anything that looks like the socket side of an `http.ServerResponse`. */
export interface FrameClient {
    writableLength: number;
    writableEnded: boolean;
}

/**
 * Who may take this frame — the fan-out rule, with no socket in sight.
 *
 * `res.write` never drops. When a reader is slower than the camera, Node queues
 * the bytes in user space and keeps queueing: the client ends up watching the
 * past, and the lag *grows* (measured: ffmpeg publishing 10 fps into a 5 fps
 * reader gained ~0.5 s of lag per second of running, without bound, and the
 * helper's heap with it). A live MJPEG client is not a download: the frame it
 * cannot take now is already stale, so it is **dropped**, never queued. A client
 * that has ended is not "dropped" either — it is simply gone.
 */
export function pickRecipients<T extends FrameClient>(
    clients: Iterable<T>,
    partBytes: number
): { send: T[]; dropped: number } {
    const send: T[] = [];
    let dropped = 0;
    for (const res of clients) {
        if (res.writableEnded) continue;
        if (res.writableLength > partBytes * QUEUE_FRAMES) {
            dropped += 1;
            continue;
        }
        send.push(res);
    }
    return { send, dropped };
}

/** One multipart part, so a client never joins the stream mid-frame. */
export function framePart(frame: Buffer): Buffer {
    return Buffer.concat([
        Buffer.from(
            `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`
        ),
        frame,
        Buffer.from('\r\n'),
    ]);
}

/**
 * The capture lifecycle: one ffmpeg shared by every client, stopped once the
 * last one leaves (unless `always`), with the last complete JPEG kept for
 * `/snapshot.jpg`.
 */
export class Webcam {
    private child: ChildProcess | null = null;
    private lastFrame: Buffer | null = null;
    private carry: Buffer = Buffer.alloc(0);
    private idle: NodeJS.Timeout | null = null;
    private stopping = false;
    private readonly clients = new Set<http.ServerResponse>();
    private framesProduced = 0;
    private framesOffered = 0;
    private framesSent = 0;
    private framesDropped = 0;

    constructor(private readonly cfg: WebcamConfig) {}

    get clientCount(): number {
        return this.clients.size;
    }

    /**
     * What the fan-out has done — the backlog, as a number.
     *
     * The arithmetic is exact, which is the point of reporting it:
     *
     * - `produced = collapsed + offered` — frames ffmpeg emitted, minus the ones that
     *   arrived in the same chunk as a newer frame and were never a candidate
     *   (the publisher's own drain);
     * - `sent` / `dropped` are **client writes and client skips**, so with a fixed
     *   client count `offered × clients = sent + dropped`.
     *
     * `dropped` climbing is healthy: that reader is slower than the camera and is
     * being kept **live** instead of queued. What must stay flat is the lag, i.e.
     * `queueBytes` (a client holding `QUEUE_FRAMES` frames of backlog is skipped, so
     * it cannot grow past that plus the socket's own kernel buffer).
     */
    get counters(): {
        produced: number;
        collapsed: number;
        offered: number;
        sent: number;
        dropped: number;
        queueBytes: number;
    } {
        let queueBytes = 0;
        for (const res of this.clients) {
            queueBytes = Math.max(queueBytes, res.writableLength);
        }
        return {
            produced: this.framesProduced,
            collapsed: this.framesProduced - this.framesOffered,
            offered: this.framesOffered,
            sent: this.framesSent,
            dropped: this.framesDropped,
            queueBytes,
        };
    }

    get streaming(): boolean {
        return !!this.child;
    }

    get frame(): Buffer | null {
        return this.lastFrame;
    }

    /**
     * ffmpeg's output → every client, **newest frame only, none queued**.
     *
     * Two rules, and both are about not watching the past:
     *
     * - the **newest** complete part is written, never the raw chunk: ffmpeg may
     *   hand several frames at once and an intermediate one is already stale, and
     *   writing whole parts is what makes dropping a frame safe (a dropped *chunk*
     *   would cut a part in half and desync the client);
     * - a client already holding `QUEUE_FRAMES` frames of backlog is skipped
     *   (`pickRecipients`) instead of queued.
     */
    private broadcast = (chunk: Buffer): void => {
        const { frames, carry } = parseFrames(chunk, this.carry);
        this.carry = carry;
        if (!frames.length) return;
        this.framesProduced += frames.length;
        this.framesOffered += 1;
        const frame = frames[frames.length - 1];
        this.lastFrame = frame;
        const part = framePart(frame);
        const { send, dropped } = pickRecipients(this.clients, part.length);
        for (const res of send) res.write(part);
        this.framesSent += send.length;
        this.framesDropped += dropped;
    };

    /** Start ffmpeg if it is not running (idempotent). */
    start(): void {
        if (this.child || this.stopping) return;
        const child = spawn(this.cfg.ffmpeg, buildCaptureArgs(this.cfg), {
            windowsHide: true,
        });
        this.child = child;
        child.stdout?.on('data', this.broadcast);
        child.stderr?.on('data', (d) =>
            process.stderr.write(`[ffmpeg] ${String(d).trim()}\n`)
        );
        child.on('error', (e) =>
            process.stderr.write(`[webcam] ffmpeg failed: ${e.message}\n`)
        );
        child.on('exit', (code) => {
            this.child = null;
            this.carry = Buffer.alloc(0);
            // A camera that was busy at boot comes back: retry while watched.
            if (this.clients.size && !this.stopping) {
                setTimeout(() => this.start(), 1000);
            } else if (code && code !== 0) {
                process.stderr.write(`[webcam] ffmpeg exited with ${code}\n`);
            }
        });
    }

    stop(): void {
        this.child?.kill();
        this.child = null;
    }

    addClient(res: http.ServerResponse): void {
        if (this.idle) {
            clearTimeout(this.idle);
            this.idle = null;
        }
        this.clients.add(res);
        this.start();
        if (this.lastFrame) res.write(framePart(this.lastFrame));
    }

    removeClient(res: http.ServerResponse): void {
        this.clients.delete(res);
        if (this.clients.size || this.cfg.always) return;
        if (this.idle) clearTimeout(this.idle);
        this.idle = setTimeout(() => this.stop(), this.cfg.idleMs);
    }

    /** One frame: the live stream's last JPEG, else a one-shot capture. */
    async snapshot(): Promise<Buffer | null> {
        if (this.lastFrame) return this.lastFrame;
        return new Promise((resolve) => {
            const proc = spawn(this.cfg.ffmpeg, buildSnapshotArgs(this.cfg), {
                windowsHide: true,
            });
            const chunks: Buffer[] = [];
            let error = '';
            proc.stdout?.on('data', (c: Buffer) => chunks.push(c));
            // Never fail silently: a 503 with no reason is impossible to debug.
            proc.stderr?.on('data', (d) => (error += String(d)));
            proc.on('error', (e) => {
                process.stderr.write(`[webcam] snapshot failed: ${e.message}\n`);
                resolve(null);
            });
            proc.on('close', () => {
                const out = Buffer.concat(chunks);
                if (!out.length) {
                    process.stderr.write(
                        `[webcam] snapshot produced no frame: ${error.trim()}\n`
                    );
                    resolve(null);
                    return;
                }
                resolve(out);
            });
        });
    }

    shutdown(): void {
        this.stopping = true;
        for (const res of this.clients) res.end();
        this.clients.clear();
        this.stop();
    }
}

/**
 * Create (or reuse) the camera provider + device and point them at this stream.
 *
 * A camera provider row **is** one camera (like a Shelly row is one plug): the
 * stream is provider config, so it is written there — never into device state.
 * The device only carries the per-camera policy ("Analyser par vision").
 */
export async function registerCamera(
    cfg: WebcamConfig,
    url: string
): Promise<string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    const token = readBrainToken(cfg.tokenFile);
    if (token) headers.Authorization = `Bearer ${token}`;

    const api = async (route: string, init?: any): Promise<any> => {
        const res = await fetch(`${cfg.brainUrl}/api/${route}`, {
            ...init,
            headers,
        });
        if (!res.ok) {
            throw new Error(
                `${route} → ${res.status} ${await res.text().catch(() => '')}`
            );
        }
        return res.status === 204 ? null : res.json().catch(() => null);
    };

    const externalId =
        process.env.WEBCAM_EXTERNAL_ID ?? `webcam-${os.hostname()}`;
    const name = process.env.WEBCAM_NAME ?? 'Webcam';

    const devices: any[] = (await api('devices')) ?? [];
    const existing = devices.find((d) => d.externalId === externalId);

    // Reuse the row this camera already points at, else adopt a row already
    // pointing at this stream (re-running the helper must not duplicate it).
    const providers: any[] = (await api('providers')) ?? [];
    let provider = existing
        ? providers.find((p) => p._id === existing.provider)
        : undefined;
    if (!provider) {
        provider = providers.find(
            (p) => p.codesource === 'camera' && p.host === url
        );
    }

    if (provider) {
        await api(`providers/${provider._id}/settings`, {
            method: 'PUT',
            body: JSON.stringify({ values: { kind: 'mjpeg', host: url } }),
        });
    } else {
        const created = await api('providers', {
            method: 'POST',
            body: JSON.stringify({
                name: process.env.WEBCAM_PROVIDER_NAME ?? name,
                codesource: 'camera',
                type: 'direct',
                host: url,
                properties: { kind: 'mjpeg' },
            }),
        });
        provider = { _id: created?.uuid };
    }

    let deviceId = existing?._id;
    if (!deviceId) {
        const created = await api('devices', {
            method: 'POST',
            body: JSON.stringify({
                name,
                externalId,
                provider: provider._id,
                type: 'camera',
            }),
        });
        deviceId = created?.uuid;
    } else if (existing.provider !== provider._id) {
        // The device outlived its provider row: repoint it (POST upserts by _id).
        await api('devices', {
            method: 'POST',
            body: JSON.stringify({
                _id: deviceId,
                name: existing.name ?? name,
                externalId,
                provider: provider._id,
                type: 'camera',
            }),
        });
    }

    // Only the mode selection is device state: this camera feeds vision-feed.
    await api(`devices/${deviceId}/state`, {
        method: 'PUT',
        body: JSON.stringify({ properties: { visionModes: 'presence' } }),
    });

    return deviceId;
}

// ===== the HTTP surface =====

/** `--flag value`, so the helper needs no argument parser. */
export function cliValue(args: string[], name: string): string | undefined {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
}

export function configFromEnv(args = process.argv.slice(2)): WebcamConfig {
    const ffmpeg = process.env.WEBCAM_FFMPEG ?? 'ffmpeg';
    const host = process.env.WEBCAM_HOST ?? '127.0.0.1';
    return {
        port: Number(
            cliValue(args, '--port') ?? process.env.WEBCAM_PORT ?? 9312
        ),
        host,
        // What the URL says: `host.docker.internal` when the feed is containerized.
        publicHost: process.env.WEBCAM_PUBLIC_HOST ?? host,
        device: cliValue(args, '--device') ?? detectDevice(ffmpeg),
        fps: Number(cliValue(args, '--fps') ?? process.env.WEBCAM_FPS ?? 10),
        size: process.env.WEBCAM_SIZE || undefined,
        quality: Number(process.env.WEBCAM_QUALITY ?? 5),
        idleMs: Number(process.env.WEBCAM_IDLE_MS ?? 5000),
        always: process.env.WEBCAM_ALWAYS === '1' || args.includes('--always'),
        ffmpeg,
        brainUrl: process.env.BRAIN_URL ?? 'http://localhost:9300',
        tokenFile:
            process.env.BRAIN_TOKEN_FILE ??
            path.join(process.cwd(), '.private', 'vision-feed.token'),
    };
}

export function createServer(cam: Webcam, cfg: WebcamConfig): http.Server {
    return http.createServer(async (req, res) => {
        const { pathname } = new URL(req.url ?? '/', 'http://localhost');

        if (pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    ok: true,
                    device: cfg.device,
                    fps: cfg.fps,
                    size: cfg.size ?? 'device default',
                    streaming: cam.streaming,
                    clients: cam.clientCount,
                    frameBytes: cam.frame?.length ?? 0,
                    frames: cam.counters,
                })
            );
            return;
        }

        if (pathname === '/snapshot.jpg' || pathname === '/snapshot') {
            const frame = await cam.snapshot();
            if (!frame) {
                res.writeHead(503, { 'Content-Type': 'text/plain' });
                res.end('no frame yet\n');
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'image/jpeg',
                'Content-Length': frame.length,
                'Cache-Control': 'no-store',
            });
            res.end(frame);
            return;
        }

        if (pathname === '/' || pathname === '/video.mjpg' || pathname === '/video') {
            res.writeHead(200, {
                'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                Pragma: 'no-cache',
            });
            cam.addClient(res);
            req.on('close', () => cam.removeClient(res));
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('try /video.mjpg, /snapshot.jpg or /health\n');
    });
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const cfg = configFromEnv(args);
    const streamUrl = `http://${cfg.publicHost}:${cfg.port}/video.mjpg`;
    const cam = new Webcam(cfg);
    const server = createServer(cam, cfg);

    server.listen(cfg.port, cfg.host, () => {
        console.log(`[webcam] device   ${cfg.device}`);
        console.log(`[webcam] live     ${streamUrl}`);
        console.log(
            `[webcam] snapshot http://${cfg.publicHost}:${cfg.port}/snapshot.jpg`
        );
        console.log(`[webcam] bound to ${cfg.host}:${cfg.port} (${cfg.fps} fps)`);
    });

    // Warm the pipeline when the snapshot alone is wanted (no live client).
    if (cfg.always) cam.start();

    if (args.includes('--register')) {
        try {
            const id = await registerCamera(cfg, streamUrl);
            console.log(
                `[webcam] camera ${id} registered — "Analyser par vision" is on`
            );
        } catch (e) {
            console.error(`[webcam] register failed: ${(e as Error).message}`);
        }
    }

    const stop = () => {
        cam.shutdown();
        server.close(() => process.exit(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

// Run only as a script (`yarn webcam`); the tests import the module instead.
const isMain =
    !!process.argv[1] && /(?:^|[\\/])webcam\.(?:ts|js)$/.test(process.argv[1]);
if (isMain) void main();

