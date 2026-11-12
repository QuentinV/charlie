/**
 * Tier-1 vision actions (no LLM): say the last document read, and push a scan to
 * the shopping list.
 *
 * A photo always comes from the Scan tab (or an API client) — the voice acts on
 * what is already there, which is why these actions read the scan history rather
 * than asking for an image.
 */
import { Tools } from '../../../types';
import { listScans, runScanAction, visionEnabled } from '../../../vision';
import { getVisionModule } from '../../../vision/modules';
import { t } from '../langs';

/** French label of a document type, for the spoken answer. */
function labelOf(type?: string): string {
    return getVisionModule(type)?.label ?? 'document';
}

/** A module action of the given id, on the last scan that offers it. */
async function lastScanWithAction(actionId: string) {
    const scans = await listScans({ limit: 5 });
    return scans.find((scan) =>
        (getVisionModule(scan.type)?.actions ?? []).some(
            (action) => action.id === actionId
        )
    );
}

export const tools: Tools = {
    readLastScan: {
        exec: async () => {
            if (!visionEnabled()) return false;

            const [last] = await listScans({ limit: 1 });
            if (!last) return t('vision.none');
            if (last.status === 'pending') return t('vision.pending');
            if (last.status === 'failed') return t('vision.failed');

            return last.summary ?? t('vision.read', { label: labelOf(last.type) });
        },
    },
    addScanToShopping: {
        exec: async (req: { user?: string }) => {
            if (!visionEnabled()) return false;

            const scan = await lastScanWithAction('add-to-shopping');
            if (!scan) return t('vision.nothingToAdd');

            const result = await runScanAction(scan._id, 'add-to-shopping', {
                user: req?.user,
            });
            return result.ok ? t('vision.shoppingAdded') : t('vision.actionFailed');
        },
    },
};

export default tools;
