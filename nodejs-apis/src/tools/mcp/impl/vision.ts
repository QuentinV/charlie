/**
 * Agent tools of the vision module.
 *
 * The agent cannot produce an image itself: it reads what the household
 * photographed and acts on it — "ajoute les ingrédients de la recette que je
 * viens de scanner" is `list-scanned-documents` followed by
 * `use-scanned-document`.
 */
import { z } from 'zod';
import { Tools, VisionScan } from '../../../types';
import {
    getScan,
    listScans,
    runScanAction,
    visionEnabled,
} from '../../../vision';
import { getVisionModule } from '../../../vision/modules';

/** Compact view of a scan for the model: no image, no raw answer. */
function describeScan(scan: VisionScan) {
    const module = getVisionModule(scan.type);
    return {
        id: scan._id,
        type: scan.type,
        label: module?.label,
        status: scan.status,
        at: scan.createdAt,
        summary: scan.summary,
        data: scan.data,
        error: scan.error,
        actions: (module?.actions ?? []).map((action) => action.id),
    };
}

const DISABLED = 'The vision module is disabled in the settings.';

const tools: Tools = {
    'list-scanned-documents': {
        description:
            'List the documents the household scanned (recipes, receipts, letters…), newest first, with the data read from each one. Call it before acting on a document the user mentions.',
        inputSchema: {
            type: z.string().optional(),
            limit: z.number().optional(),
        },
        exec: async ({ type, limit }) => {
            if (!visionEnabled()) return DISABLED;

            const scans = await listScans({
                type,
                limit: Math.min(Math.max(limit ?? 5, 1), 20),
            });
            if (!scans.length) return 'No scanned document yet.';

            return JSON.stringify({
                documents: scans.map(describeScan),
            });
        },
    },
    'read-scanned-document': {
        description:
            'Read the full data extracted from one scanned document, by its id (see list-scanned-documents).',
        inputSchema: { id: z.string() },
        exec: async ({ id }) => {
            if (!visionEnabled()) return DISABLED;

            const scan = await getScan(id);
            if (!scan) return `No scanned document with id ${id}.`;
            return JSON.stringify(describeScan(scan));
        },
    },
    'use-scanned-document': {
        description:
            'Run one of a scanned document’s actions (`actions` of list-scanned-documents): for a recipe, `save-to-recipes` files it in the household recipe library, where its ingredients reach the shopping list from.',
        inputSchema: { id: z.string(), action: z.string() },
        exec: async ({ id, action }, ctx) => {
            if (!visionEnabled()) return DISABLED;

            const result = await runScanAction(id, action, { user: ctx?.user });
            return result.ok
                ? (result.message ?? `Ran ${action}.`)
                : `Could not run ${action}: ${result.error}`;
        },
    },
};

export default tools;
