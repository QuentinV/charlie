/**
 * Camera source resolution: a **provider row** → the descriptor the
 * `vision-feed` service consumes.
 *
 * A camera provider row is one camera (like a Shelly provider row is one plug),
 * so the source is provider config: `kind` in `provider.properties.kind`, the
 * stream in `provider.host` (a URL, or the webcam index), the credentials in
 * `provider.user`/`password`. The device only names the remote object
 * (`externalId`) — an HA entity, an echo device — which is why nothing
 * camera-specific sits on `Device` anymore.
 *
 * Pure (no I/O): the HA base URL / token are runtime state passed in by the
 * caller, so this is unit-testable without booting the HA client.
 */
import { Device, Provider } from '../types';

/** How a camera's frames are pulled. */
export type CameraSourceKind = 'webcam' | 'rtsp' | 'mjpeg' | 'ha' | 'echo';

export const CAMERA_SOURCE_KINDS: CameraSourceKind[] = [
    'webcam',
    'rtsp',
    'mjpeg',
    'ha',
    'echo',
];

/** A provider row read as a camera source (a view, never a stored struct). */
export interface CameraSource {
    kind: CameraSourceKind;
    /** rtsp/mjpeg: the stream URL; webcam: the device index as text. */
    url?: string;
    /**
     * mjpeg: an explicit single-frame URL, for cameras whose `url` is a live
     * multipart stream (which never ends — see `cameras/snapshot.ts`). Only the
     * on-demand questions use it; the live feed always reads `url`.
     */
    snapshotUrl?: string;
}

export function isCameraSourceKind(value: unknown): value is CameraSourceKind {
    return CAMERA_SOURCE_KINDS.includes(value as CameraSourceKind);
}

/**
 * Which kind a provider row is. HA cameras derive it from the codesource (the
 * entity id is the device's `externalId`), so a Home Assistant camera needs no
 * configuration at all; Charlie's own cameras read `properties.kind`.
 */
export function sourceKindOf(
    provider?: Provider | null
): CameraSourceKind | undefined {
    if (!provider) return undefined;
    if (provider.codesource === 'homeassistant') return 'ha';
    const kind = provider.properties?.kind;
    return isCameraSourceKind(kind) ? kind : undefined;
}

/** The provider's camera source, or undefined when it is not a camera. */
export function cameraSourceOf(
    provider?: Provider | null
): CameraSource | undefined {
    const kind = sourceKindOf(provider);
    if (!kind) return undefined;

    const snapshotUrl = provider?.properties?.snapshotUrl;
    return {
        kind,
        url: provider?.host?.trim() || undefined,
        snapshotUrl:
            typeof snapshotUrl === 'string' && snapshotUrl.trim()
                ? snapshotUrl.trim()
                : undefined,
    };
}

/**
 * What a human recognises as a camera's source: the entity id for `ha`/`echo`
 * (the device's `externalId`), else the URL — and a webcam's index, which
 * defaults to 0 exactly like the feed does.
 */
export function sourceTarget(device: Device, source?: CameraSource): string {
    if (!source) return '';
    if (source.kind === 'ha' || source.kind === 'echo') {
        return device.externalId ?? '';
    }
    if (source.kind === 'webcam') return source.url || '0';
    return source.url ?? '';
}

/**
 * Why a camera has no usable source — a **code**, never a message (the UI
 * translates it). `resolveSource` answers null for all of these, so the device
 * page could not tell a missing type from an empty URL; this is the difference,
 * and it is what turns a silent `—` into an actionable line.
 */
export type CameraSourceIssue =
    | 'provider-missing'
    | 'no-kind'
    | 'no-url'
    | 'no-entity'
    | 'ha-unavailable';

/** The first thing missing for this camera to feed, or undefined when it can. */
export function cameraSourceIssue(
    device: Device,
    provider: Provider | null | undefined,
    opts: ResolveOptions = {}
): CameraSourceIssue | undefined {
    const kind = sourceKindOf(provider);
    // The type is the gate: without it nothing else is read, so a row with a
    // URL and no type is the one mistake worth naming.
    if (!kind) return provider ? 'no-kind' : 'provider-missing';

    const source = cameraSourceOf(provider);
    switch (kind) {
        case 'webcam':
            // The index defaults to 0: a webcam never lacks a source.
            return undefined;
        case 'rtsp':
        case 'mjpeg':
            return source?.url ? undefined : 'no-url';
        case 'ha':
            if (!device.externalId) return 'no-entity';
            return opts.haBaseUrl ? undefined : 'ha-unavailable';
        case 'echo':
            return device.externalId ? undefined : 'no-entity';
        default:
            return 'no-kind';
    }
}

/**
 * The read-only view of a camera's source, for the device page: what the feed
 * would open, and — when it would open nothing — why.
 *
 * Derived on read and **never stored on the device**: the source is provider
 * config, so the panel shows the provider row's truth instead of a copy that
 * can only be stale (and that an HA camera's shared row could never fill).
 * Never carries the HA token.
 */
export interface CameraSourceView {
    /** The provider row read as a source (kind + URL), null when it has none. */
    source: CameraSource | null;
    /** The entity id (ha/echo) or the URL a human recognises. */
    target: string;
    /** Why the feed cannot open this camera — present only when it cannot. */
    issue?: CameraSourceIssue;
}

export function cameraSourceView(
    device: Device,
    provider: Provider | null | undefined,
    opts: ResolveOptions = {}
): CameraSourceView {
    const source = cameraSourceOf(provider) ?? null;
    const issue = cameraSourceIssue(device, provider, opts);
    return {
        source,
        target: sourceTarget(device, source ?? undefined),
        ...(issue ? { issue } : {}),
    };
}

/** What the feed opens for a camera. */
export interface FeedSource {
    kind: CameraSourceKind;
    /** webcam: the device index as text; rtsp/mjpeg: the URL; ha: the snapshot URL. */
    url: string;
    /** Bearer token (HA snapshot), when the source needs one. */
    token?: string;
    user?: string;
    password?: string;
}

export interface ResolveOptions {
    haBaseUrl?: string;
    haToken?: string;
}

/**
 * Does the feed have to be fetched **through the brain** rather than by opening
 * this URL itself? An `mjpeg` URL is often host-local (a webcam helper on
 * `127.0.0.1`, a phone app on the LAN) and an `ha` proxy needs the HA token —
 * neither is reachable/openable from the `vision-feed` container. `rtsp` is left
 * direct (nothing here speaks RTSP, and the container reaches the LAN), and a
 * `webcam` index only exists where the feed runs.
 */
export function relaysSource(kind?: CameraSourceKind): boolean {
    return kind === 'mjpeg' || kind === 'ha';
}

/** A camera provider + its device → the feed descriptor, or null when unusable. */
export function resolveSource(
    device: Device,
    provider: Provider | null | undefined,
    opts: ResolveOptions = {}
): FeedSource | null {
    const source = cameraSourceOf(provider);
    if (!source) return null;

    switch (source.kind) {
        case 'webcam':
            // `url` holds the device index as text ("0"); the feed maps it to
            // `cv2.VideoCapture(index)`.
            return { kind: 'webcam', url: source.url || '0' };
        case 'rtsp':
        case 'mjpeg':
            if (!source.url) return null;
            return {
                kind: source.kind,
                url: source.url,
                user: provider?.user,
                password: provider?.password,
            };
        case 'ha': {
            // The device names the entity; the provider row is the HA instance.
            if (!device.externalId || !opts.haBaseUrl) return null;
            return {
                kind: 'ha',
                url: `${opts.haBaseUrl}/api/camera_proxy/${device.externalId}`,
                token: opts.haToken,
            };
        }
        case 'echo':
            if (!device.externalId) return null;
            return { kind: 'echo', url: device.externalId };
        default:
            return null;
    }
}
