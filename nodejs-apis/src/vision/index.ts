/**
 * The vision module: one photographed document → data the home can act on.
 *
 *   bytes → image on disk + a `pending` record
 *     → the caller's type, or one classifier call   (`detect.ts`)
 *     → extraction with the module's schema          (`extract.ts`)
 *     → module validation (`parse`) → `done` / `failed` (retryable)
 *
 * Two calls, and that is a measured decision: the classifier's closed enum keeps
 * the fields and units honest, while the router's prompt cache reuses the encoded
 * image for the extraction call (72 new tokens / 5 s against 36 s for the first
 * one). A single call carrying a free-form answer was measured and rejected — it
 * invents units the image does not give.
 *
 * A failed scan keeps its image: the tab can retry or correct the type without
 * photographing the paper again (`rescan`).
 */
import { v7 as uuid } from 'uuid';
import { visionModel } from '../ai/llm';
import { log } from '../manager/services/activities';
import { settings } from '../manager/services/settings';
import { VisionScan, VisionScanSource, VisionTypeSource } from '../types';
import { detectType, forcedModule } from './detect';
import { extractDocument } from './extract';
import {
    dataUrl,
    deleteImage,
    normalizedImageMime,
    rotateImages,
    saveImage,
} from './images';
import { getVisionModule, visionModuleCatalogue } from './modules';
import { VisionContext, VisionModule } from './modules/types';
import {
    createScan,
    deleteScan,
    getScan,
    listScans,
    updateScan,
} from './store';
import type { ScanQuery } from './store';

export { getScan, listScans, visionModuleCatalogue };
export type { ScanQuery };

/** Defaults, overridable from the settings (Settings → Vision). */
const DEFAULT_KEEP_SCANS = 50;
const DEFAULT_MAX_IMAGE_MB = 25;

/** The module is on unless explicitly disabled in the settings. */
export function visionEnabled(): boolean {
    return settings.vision?.enabled !== false;
}

/** How many scan images are kept on disk (the rotation). */
export function scansToKeep(): number {
    const fromSettings = Number(settings.vision?.keepScans);
    if (Number.isFinite(fromSettings) && fromSettings > 0) {
        return Math.floor(fromSettings);
    }
    const fromEnv = Number(process.env.VISION_KEEP_SCANS);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
    return DEFAULT_KEEP_SCANS;
}

/** Largest accepted upload (MB). */
export function maxImageMb(): number {
    const fromSettings = Number(settings.vision?.maxImageMb);
    if (Number.isFinite(fromSettings) && fromSettings > 0) return fromSettings;
    const fromEnv = Number(process.env.VISION_MAX_IMAGE_MB);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
    return DEFAULT_MAX_IMAGE_MB;
}

/** Model id the scans are read with (the router-served vision model). */
export function visionModelId(): string | undefined {
    return visionModel();
}

export interface ScanOptions {
    /** Module id, when the caller already knows the document type. */
    type?: string;
    source?: VisionScanSource;
    /** Recognized speaker / account. */
    user?: string;
    /**
     * Start the reading in the background (default) and return the `pending`
     * record, or leave it to the caller (`read: false`). The HTTP routes need
     * the background mode: a CPU vision read takes minutes, far beyond a proxy
     * timeout, so the client polls the record instead.
     */
    read?: boolean;
}

const SOURCES: VisionScanSource[] = ['ui', 'api', 'voice', 'camera'];

/** Read a source value coming from an HTTP query or body. */
export function scanSource(value?: unknown): VisionScanSource {
    return SOURCES.includes(value as VisionScanSource)
        ? (value as VisionScanSource)
        : 'api';
}

/** Store a new image as a `pending` scan (the entry point of every upload). */
export async function addImageScan(
    buffer: Buffer,
    mime: string | undefined,
    options: ScanOptions = {}
): Promise<VisionScan> {
    const normalized = normalizedImageMime(mime);
    if (!normalized) {
        throw new Error('unsupported image type (jpeg, png, webp or gif)');
    }
    if (!buffer?.length) throw new Error('empty image');

    const id = uuid();
    const image = saveImage(id, buffer, normalized);

    const rotated = rotateImages(scansToKeep());
    if (rotated) log('vision', `Rotated ${rotated} scan image(s)`);

    const scan: VisionScan = {
        _id: id,
        status: 'pending',
        source: options.source ?? 'api',
        ...(options.type ? { type: options.type } : {}),
        ...(options.user ? { user: options.user } : {}),
        image,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    await createScan(scan);

    if (options.read !== false) backgroundRead(id, options.type);
    return scan;
}

/** Store the image and return the finished scan (tests, CLI, agent tools). */
export async function scanImage(
    buffer: Buffer,
    mime: string | undefined,
    options: ScanOptions = {}
): Promise<VisionScan> {
    const scan = await addImageScan(buffer, mime, { ...options, read: false });
    return (await readScan(scan._id, options.type))!;
}

/** Read a stored scan. A type already on the record is reused, never re-asked. */
export async function readScan(
    id: string,
    forcedType?: string
): Promise<VisionScan | undefined> {
    const scan = await getScan(id);
    if (!scan) return undefined;
    return runScan(scan, forcedType ?? scan.type);
}

/**
 * Start a reading job and answer immediately with the `pending` record — what
 * the upload and rescan routes use (see `ScanOptions.read`).
 */
export async function startReading(
    id: string,
    forcedType?: string
): Promise<VisionScan | undefined> {
    const scan = await getScan(id);
    if (!scan) return undefined;
    if (scan.status !== 'pending') {
        await updateScan(id, { status: 'pending', error: undefined });
    }
    backgroundRead(id, forcedType);
    return getScan(id);
}

/** Fire-and-forget reading, so a route never holds a request open for minutes. */
function backgroundRead(id: string, forcedType?: string): void {
    void readScan(id, forcedType).catch((e) =>
        console.error('[vision] background read failed:', e?.message ?? e)
    );
}

/** Re-run a scan on its stored image: a retry, or a corrected type (awaited). */
export async function rescan(
    id: string,
    options?: { type?: string; user?: string }
): Promise<VisionScan | undefined> {
    const scan = await getScan(id);
    if (!scan) return undefined;

    await updateScan(id, { status: 'pending', error: undefined });
    return readScan(id, options?.type);
}

// --- the pipeline ---

/** What one run reports back to the record. */
interface ScanOutcome {
    module: VisionModule<any>;
    typeSource: VisionTypeSource;
    data: any;
    /** Raw extraction answer, kept for prompt debugging. */
    raw: string;
    timingMs: { detect?: number; extract?: number };
    /** Classifier answer, logged (never stored: one enum value). */
    detectAnswer?: string;
}

/**
 * One scan. A type the caller named is trusted (no classifier call); otherwise
 * the document is classified first, then extracted.
 */
async function runScan(
    scan: VisionScan,
    forcedType?: string
): Promise<VisionScan> {
    const started = Date.now();
    const image = dataUrl(scan.image);
    if (!image) {
        return (await updateScan(scan._id, {
            status: 'failed',
            error: 'the image is no longer on disk (rotated or removed)',
        }))!;
    }

    try {
        const forced = forcedType ? forcedModule(forcedType) : undefined;
        if (forcedType && !forced) {
            throw new Error(`unknown document type ${forcedType}`);
        }
        if (forced) {
            const extractStarted = Date.now();
            const { data, raw } = await extractDocument(forced, image);
            return finishScan(scan, {
                module: forced,
                typeSource: 'forced',
                data,
                raw,
                timingMs: { extract: Date.now() - extractStarted },
            });
        }

        return await runTwoPhase(scan, image, started);
    } catch (e) {
        return failScan(scan, e);
    }
}

/** Default path: classify, then extract with the schema of the resolved module. */
async function runTwoPhase(
    scan: VisionScan,
    image: string,
    started: number
): Promise<VisionScan> {
    const detection = await detectType(image);
    const detectMs = Date.now() - started;

    // The type is persisted before the extraction: a failed extraction then
    // keeps it, so a retry (`rescan`) goes straight back to the second call.
    await updateScan(scan._id, {
        type: detection.module.id,
        typeSource: detection.source,
    });

    const extractStarted = Date.now();
    const { data, raw } = await extractDocument(detection.module, image);

    return finishScan(scan, {
        module: detection.module,
        typeSource: detection.source,
        data,
        raw,
        timingMs: { detect: detectMs, extract: Date.now() - extractStarted },
        ...(detection.raw ? { detectAnswer: detection.raw } : {}),
    });
}

/** Persist a successful run and report it in the activity log. */
async function finishScan(
    scan: VisionScan,
    outcome: ScanOutcome
): Promise<VisionScan> {
    const updated = (await updateScan(scan._id, {
        status: 'done',
        type: outcome.module.id,
        typeSource: outcome.typeSource,
        data: outcome.data,
        raw: outcome.raw,
        summary: outcome.module.summarize?.(outcome.data),
        model: visionModelId(),
        timingMs: outcome.timingMs,
    }))!;

    log('vision', `Scanned a ${outcome.module.id}`, {
        context: {
            scanId: scan._id,
            type: outcome.module.id,
            typeSource: outcome.typeSource,
            bytes: scan.image.bytes,
            ...outcome.timingMs,
            ...(outcome.detectAnswer
                ? { detectAnswer: outcome.detectAnswer }
                : {}),
        },
    });
    return updated;
}

/** A failed run keeps its image: the tab can retry or correct the type. */
async function failScan(scan: VisionScan, e: unknown): Promise<VisionScan> {
    const message = (e as any)?.message ?? 'the vision model failed';
    log('vision', `Scan failed: ${message}`, {
        context: { scanId: scan._id, type: scan.type },
        data: { error: JSON.stringify(e) },
    });
    return (await updateScan(scan._id, {
        status: 'failed',
        error: message,
    }))!;
}

/** Delete a scan and its image. */
export async function removeScan(id: string): Promise<boolean> {
    const scan = await deleteScan(id);
    if (!scan) return false;
    deleteImage(scan.image);
    return true;
}

export interface ScanActionResult {
    ok: boolean;
    message?: string;
    error?: string;
}

/** Run one of a module's follow-ups on a stored result (recipe → shopping). */
export async function runScanAction(
    id: string,
    actionId: string,
    ctx?: VisionContext
): Promise<ScanActionResult> {
    const scan = await getScan(id);
    if (!scan) return { ok: false, error: 'scan not found' };
    if (scan.status !== 'done' || !scan.data) {
        return { ok: false, error: 'this scan has no result to act on' };
    }

    const module = getVisionModule(scan.type);
    const action = module?.actions?.find((a) => a.id === actionId);
    if (!module || !action) {
        return { ok: false, error: `unknown action ${actionId}` };
    }

    try {
        const result = await action.run(scan.data, { ...ctx, scanId: scan._id });
        log('vision', `Action ${actionId} on a ${module.id}`, {
            context: { scanId: scan._id },
        });
        return {
            ok: true,
            message: typeof result === 'string' ? result : `Ran ${actionId}`,
        };
    } catch (e) {
        return {
            ok: false,
            error: (e as any)?.message ?? 'the action failed',
        };
    }
}


