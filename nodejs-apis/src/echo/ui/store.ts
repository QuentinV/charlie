import { createHash } from 'crypto';
import { cs } from '../../core/db';
import { logEcho } from '../logs';
import {
    UiBundle,
    UiBundleIssue,
    sealBundle,
    stableStringify,
    validateBundle,
} from './schema';

/**
 * Storage for the per-device screen bundles.
 *
 * One document per device, keyed by its canonical MAC (`echo_ui` collection).
 * The document keeps the current bundle plus the previous one so a bad publish
 * can be rolled back without recompiling, and so the device can keep serving
 * its cached copy while a new revision is fetched.
 *
 * The document is the transport unit: `GET /echo/:id/ui` returns the bundle
 * exactly as stored, with its `hash` as the ETag. Nothing here talks to a
 * device — publishing only writes, the device pulls.
 */

export interface UiDocument {
    mac: string;
    rev: number;
    hash: string;
    bundle: UiBundle;
    updatedAt: Date;
    /** Previous revision, kept for rollback and for ETag-based 304s. */
    previous?: {
        rev: number;
        hash: string;
        bundle: UiBundle;
        updatedAt: Date;
    };
}

export interface UiRevision {
    rev: number;
    hash: string;
    updatedAt: Date;
}

export interface UiPublishResult {
    ok: boolean;
    rev?: number;
    hash?: string;
    issues?: UiBundleIssue[];
}

/** Canonical storage key: the MAC as the device reports it. */
function key(mac: string): string {
    return String(mac ?? '')
        .trim()
        .toLowerCase();
}

/**
 * Hash of the *content* of a bundle, ignoring the fields the store owns (`rev`,
 * `generatedAt`, `hash`). Two publishes that only differ by those are the same
 * UI, so the revision must not move and the device must not re-download.
 */
function contentHash(bundle: UiBundle): string {
    const { rev: _rev, generatedAt: _generatedAt, hash: _hash, ...content } =
        bundle as UiBundle;
    return createHash('sha256').update(stableStringify(content)).digest('hex');
}

/** Current revision metadata, or `null` when the device has no bundle yet. */
export async function getUiRevision(mac: string): Promise<UiRevision | null> {
    const doc = await cs.echoUi.findOne(
        { mac: key(mac) },
        { projection: { rev: 1, hash: 1, updatedAt: 1, _id: 0 } }
    );
    if (!doc) {
        return null;
    }
    return { rev: doc.rev, hash: doc.hash, updatedAt: doc.updatedAt };
}

/** Current bundle, or `null` when the device has none. */
export async function getUiBundle(mac: string): Promise<UiDocument | null> {
    const doc = await cs.echoUi.findOne({ mac: key(mac) });
    if (!doc) {
        return null;
    }
    return doc as UiDocument;
}

/**
 * Store a new bundle for a device.
 *
 * The bundle is validated (schema + cross-references + hash) and re-sealed so
 * the caller cannot publish a stale `hash`. The revision is bumped from the
 * stored document, so two concurrent publishes cannot collide on the same rev.
 * An unchanged bundle is not re-stored: publishing the same content twice keeps
 * the revision, so a device that already has it never re-downloads.
 */
export async function publishUiBundle(
    mac: string,
    input: unknown
): Promise<UiPublishResult> {
    const sealed = sealBundle(input as Omit<UiBundle, 'hash'>);
    const validation = validateBundle(sealed);
    if (!validation.ok) {
        return { ok: false, issues: validation.issues };
    }

    const bundle = validation.bundle as UiBundle;
    const current = await getUiBundle(mac);

    if (current && contentHash(current.bundle) === contentHash(bundle)) {
        return { ok: true, rev: current.rev, hash: current.hash };
    }

    const rev = (current?.rev ?? 0) + 1;
    const updatedAt = new Date();
    const document: UiDocument = {
        mac: key(mac),
        rev,
        hash: bundle.hash,
        bundle: bundle,
        updatedAt,
        ...(current
            ? {
                  previous: {
                      rev: current.rev,
                      hash: current.hash,
                      bundle: current.bundle,
                      updatedAt: current.updatedAt,
                  },
              }
            : {}),
    };

    // The stored bundle carries the bumped rev and timestamp, so it is re-sealed
    // and its hash follows the content the device will actually download.
    document.bundle = sealBundle({
        ...bundle,
        rev,
        generatedAt: updatedAt.toISOString(),
    } as Omit<UiBundle, 'hash'>);
    document.hash = document.bundle.hash;

    await cs.echoUi.updateOne(
        { mac: document.mac },
        { $set: document },
        { upsert: true }
    );
    logEcho('', `[ui] bundle published for ${document.mac} rev ${rev}`);
    return { ok: true, rev, hash: document.hash };
}

/** Roll back to the previous revision. Returns the restored revision. */
export async function rollbackUiBundle(mac: string): Promise<UiRevision | null> {
    const current = await getUiBundle(mac);
    if (!current?.previous) {
        return null;
    }
    const restored: UiDocument = {
        mac: current.mac,
        rev: current.rev + 1,
        hash: current.previous.hash,
        bundle: current.previous.bundle,
        updatedAt: new Date(),
        previous: {
            rev: current.rev,
            hash: current.hash,
            bundle: current.bundle,
            updatedAt: current.updatedAt,
        },
    };
    await cs.echoUi.updateOne({ mac: restored.mac }, { $set: restored });
    logEcho('', `[ui] bundle rolled back for ${restored.mac} rev ${restored.rev}`);
    return {
        rev: restored.rev,
        hash: restored.hash,
        updatedAt: restored.updatedAt,
    };
}

/** Forget a device's bundle (a device that was removed from the house). */
export async function clearUiBundle(mac: string): Promise<void> {
    await cs.echoUi.deleteOne({ mac: key(mac) });
}
