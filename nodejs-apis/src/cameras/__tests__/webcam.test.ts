/**
 * The standalone webcam helper's pure parts: the ffmpeg command lines per
 * platform, the dshow device parser (fed the *captured* output of
 * `ffmpeg -list_devices true -f dshow -i dummy` — never an invented shape), the
 * MJPEG frame splitter behind `/snapshot.jpg`, the fan-out rule that keeps a live
 * client from being handed a backlog, and the env/CLI defaults.
 *
 * The server lifecycle and ffmpeg itself are I/O: verified by running the
 * helper, not here.
 */
import {
    BOUNDARY,
    QUEUE_FRAMES,
    buildCaptureArgs,
    buildSnapshotArgs,
    cliValue,
    configFromEnv,
    framePart,
    inputArgs,
    parseDshowDevices,
    parseFrames,
    pickRecipients,
} from '../webcam';

/** Captured from `ffmpeg -list_devices true -f dshow -i dummy` (ffmpeg 5.x). */
const DSHOW_OUTPUT = `[dshow @ 000002c1ee051140] "Laptop Webcam Module (2nd Gen)" (video)
[dshow @ 000002c1ee051140]   Alternative name "@device_pnp_\\\\?\\usb#vid_32ac&pid_001c&mi_00#7&31f416e6&0&0000#{65e8773d-8f56-11d0-a3b9-00a0c9223196}\\global"
[dshow @ 000002c1ee051140] "Réseau de microphones (Realtek(R) Audio)" (audio)
[dshow @ 000002c1ee051140]   Alternative name "@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave_{6B5DC082-AFBD-4ED2-A5CB-5D3D4C9BC73B}"`;

const jpeg = (tag: string) =>
    Buffer.concat([
        Buffer.from([0xff, 0xd8]),
        Buffer.from(tag),
        Buffer.from([0xff, 0xd9]),
    ]);

describe('inputArgs', () => {
    it('opens a named dshow device without forcing an input frame rate', () => {
        const args = inputArgs('win32', 'Laptop Webcam Module (2nd Gen)', 10);

        expect(args).toEqual([
            '-f',
            'dshow',
            '-i',
            'video=Laptop Webcam Module (2nd Gen)',
        ]);
        // dshow refuses `-framerate` on many cameras; the output `-r` sets it.
        expect(args).not.toContain('-framerate');
    });

    it('passes a size only when asked (dshow rejects unsupported modes)', () => {
        expect(inputArgs('win32', 'cam', 5, '1280x720')).toContain('1280x720');
        expect(inputArgs('win32', 'cam', 5)).not.toContain('1280x720');
    });

    it('uses v4l2 on Linux and avfoundation on macOS', () => {
        expect(inputArgs('linux', '', 2)).toEqual([
            '-f',
            'v4l2',
            '-framerate',
            '2',
            '-i',
            '/dev/video0',
        ]);
        expect(inputArgs('darwin', '', 2)).toEqual([
            '-f',
            'avfoundation',
            '-framerate',
            '2',
            '-i',
            '0',
        ]);
    });
});

describe('ffmpeg command lines', () => {
    it('streams MJPEG multipart to stdout', () => {
        const args = buildCaptureArgs({
            device: 'cam',
            platform: 'win32',
            fps: 10,
            quality: 5,
        });

        expect(args).toContain('mjpeg');
        expect(args.slice(-3)).toEqual(['-f', 'mpjpeg', '-']);
        expect(args).toContain('-an');
        expect(args.join(' ')).toContain('-q:v 5');
    });

    it('captures a single frame for /snapshot.jpg', () => {
        const args = buildSnapshotArgs({
            device: '/dev/video0',
            platform: 'linux',
        });

        expect(args.join(' ')).toContain('-frames:v 1');
        expect(args.slice(-3)).toEqual(['-f', 'image2pipe', '-']);
    });
});

describe('parseDshowDevices', () => {
    it('keeps video devices and drops alternative names and audio', () => {
        expect(parseDshowDevices(DSHOW_OUTPUT)).toEqual([
            'Laptop Webcam Module (2nd Gen)',
        ]);
    });

    it('returns nothing for empty output', () => {
        expect(parseDshowDevices('')).toEqual([]);
    });
});

describe('parseFrames', () => {
    it('splits a chunk into complete JPEGs', () => {
        const chunk = Buffer.concat([jpeg('one'), jpeg('two')]);
        const { frames } = parseFrames(chunk);

        expect(frames.map((f) => f.toString('latin1'))).toEqual([
            jpeg('one').toString('latin1'),
            jpeg('two').toString('latin1'),
        ]);
    });

    it('carries an unfinished frame to the next chunk', () => {
        const whole = jpeg('split');
        const first = parseFrames(whole.subarray(0, 5));
        expect(first.frames).toEqual([]);
        expect(first.carry.length).toBe(5);

        const second = parseFrames(whole.subarray(5), first.carry);
        expect(second.frames.map((f) => f.toString('latin1'))).toEqual([
            whole.toString('latin1'),
        ]);
    });

    it('keeps at most one trailing byte (a marker split across chunks)', () => {
        const { carry } = parseFrames(jpeg('a'));

        expect(carry.length).toBeLessThanOrEqual(1);
    });

    it('keeps a trailing 0xff that may start the next frame', () => {
        const { frames, carry } = parseFrames(
            Buffer.concat([jpeg('a'), Buffer.from([0xff])])
        );

        expect(frames).toHaveLength(1);
        expect(carry).toEqual(Buffer.from([0xff]));
    });
});

describe('framePart', () => {
    it('wraps a frame in a well-formed part on the ffmpeg boundary', () => {
        const frame = jpeg('x');
        const part = framePart(frame).toString('latin1');

        expect(part.startsWith(`--${BOUNDARY}\r\n`)).toBe(true);
        expect(part).toContain('Content-Type: image/jpeg');
        expect(part).toContain(`Content-Length: ${frame.length}`);
        expect(part.endsWith('\r\n')).toBe(true);
    });
});

describe('pickRecipients', () => {
    const client = (writableLength: number, writableEnded = false) => ({
        writableLength,
        writableEnded,
    });

    it('sends to a client that can take the frame', () => {
        const res = client(0);
        expect(pickRecipients([res], 100)).toEqual({ send: [res], dropped: 0 });
    });

    it('drops the frame for a client that is behind, it is never queued', () => {
        // `res.write` would accept this without complaint and grow the queue.
        const behind = client(100 * QUEUE_FRAMES + 1);
        const ok = client(100 * QUEUE_FRAMES - 1);

        const { send, dropped } = pickRecipients([behind, ok], 100);

        expect(send).toEqual([ok]);
        expect(dropped).toBe(1);
    });

    it('does not count an ended client as dropped — it is simply gone', () => {
        const gone = client(99_999, true);
        const { send, dropped } = pickRecipients([gone], 100);

        expect(send).toEqual([]);
        expect(dropped).toBe(0);
    });

    it('keeps serving the fast clients while one is behind', () => {
        const clients = [client(0), client(1e6), client(0), client(0)];

        const { send, dropped } = pickRecipients(clients, 1000);

        expect(send).toHaveLength(3);
        expect(dropped).toBe(1);
    });
});

describe('config', () => {
    const keys = [
        'WEBCAM_DEVICE',
        'WEBCAM_PORT',
        'WEBCAM_HOST',
        'WEBCAM_FPS',
        'WEBCAM_SIZE',
        'WEBCAM_PUBLIC_HOST',
    ];
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const key of keys) {
            saved[key] = process.env[key];
            delete process.env[key];
        }
        // Keeps `detectDevice()` off ffmpeg in the tests.
        process.env.WEBCAM_DEVICE = 'test-cam';
    });

    afterEach(() => {
        for (const key of keys) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    it('defaults to a loopback-only stream on 9312', () => {
        const cfg = configFromEnv([]);

        expect(cfg.port).toBe(9312);
        expect(cfg.host).toBe('127.0.0.1');
        expect(cfg.publicHost).toBe('127.0.0.1');
        expect(cfg.fps).toBe(10);
        expect(cfg.device).toBe('test-cam');
        expect(cfg.always).toBe(false);
    });

    it('lets the CLI and the env override the defaults', () => {
        process.env.WEBCAM_PORT = '9400';
        process.env.WEBCAM_PUBLIC_HOST = 'host.docker.internal';

        expect(configFromEnv(['--port', '9412', '--fps', '3']).port).toBe(9412);
        expect(configFromEnv(['--fps', '3']).fps).toBe(3);
        expect(configFromEnv(['--always']).always).toBe(true);
        expect(configFromEnv([]).publicHost).toBe('host.docker.internal');
    });

    it('reads `--flag value` pairs', () => {
        expect(cliValue(['--device', 'cam 2'], '--device')).toBe('cam 2');
        expect(cliValue(['--always'], '--device')).toBeUndefined();
    });
});
