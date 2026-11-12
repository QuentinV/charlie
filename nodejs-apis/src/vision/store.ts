/**
 * Persistence of the scans: one document per scan in `vision_scans`, the image
 * itself staying on disk (`images.ts`). Deliberately dumb — the pipeline
 * (`vision/index.ts`) decides what a record means, this only reads and writes it.
 */
import { cs } from '../core/db';
import { VisionScan } from '../types';

export interface ScanQuery {
    /** Module id (`recipe`) — the tab filters on it. */
    type?: string;
    status?: string;
    limit?: number;
}

const MAX_PAGE = 200;

export async function createScan(scan: VisionScan): Promise<VisionScan> {
    await cs.visionScans.insertOne({ ...scan });
    return scan;
}

export async function getScan(id: string): Promise<VisionScan | undefined> {
    return (await cs.visionScans.findOne({ _id: id })) ?? undefined;
}

/** Patch a record (the pipeline's state machine) and return the fresh version. */
export async function updateScan(
    id: string,
    patch: Partial<VisionScan>
): Promise<VisionScan | undefined> {
    await cs.visionScans.updateOne(
        { _id: id },
        { $set: { ...patch, updatedAt: Date.now() } }
    );
    return getScan(id);
}

/** Scans newest first, optionally filtered by type/status. */
export async function listScans(query: ScanQuery = {}): Promise<VisionScan[]> {
    const filter: { [key: string]: string } = {};
    if (query.type) filter.type = query.type;
    if (query.status) filter.status = query.status;

    const limit = Math.min(Math.max(query.limit ?? 20, 1), MAX_PAGE);

    return cs.visionScans
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
}

/** Delete a record and return it, so the caller can drop its image too. */
export async function deleteScan(id: string): Promise<VisionScan | undefined> {
    const scan = await getScan(id);
    if (!scan) return undefined;
    await cs.visionScans.deleteOne({ _id: id });
    return scan;
}
