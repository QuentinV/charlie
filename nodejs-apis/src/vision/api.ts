/**
 * REST surface of the vision module.
 *
 * Two mounts, for two different reasons:
 * - the **upload** route is registered by `registerVisionUpload(app)` *before*
 *   the global `express.json()` (see `restapi-setup..ts`): a phone photo is
 *   megabytes and the default 100 kB parser would reject it before any route
 *   runs. It accepts raw bytes (`Content-Type: image/*`) or a JSON body
 *   `{"image": "data:image/…;base64,…" | "http://…"}`;
 * - everything else goes through the normal `RestApis` table (`manager/index.ts`),
 *   so it appears in Swagger like the shopping routes.
 *
 * The whole surface stays behind the auth gate: a scan is a private document.
 */
import express from 'express';
import { defaultApiPath } from '../swagger';
import { RestApis, VisionScan } from '../types';
import { readImage } from './images';
import {
    addImageScan,
    getScan,
    listScans,
    maxImageMb,
    removeScan,
    runScanAction,
    scanSource,
    scansToKeep,
    startReading,
    visionEnabled,
    visionModelId,
    visionModuleCatalogue,
} from './index';

/** Public shape of a scan: `id` instead of `_id`, plus the image URL. */
export function publicScan(scan: VisionScan) {
    const { _id, ...rest } = scan;
    return {
        id: _id,
        ...rest,
        imageUrl: `${defaultApiPath}vision/scans/${_id}/image`,
    };
}

/** The bytes of an upload: a raw body, a data URL or an http(s) URL. */
async function uploadBytes(req: any): Promise<{ buffer: Buffer; mime?: string }> {
    if (Buffer.isBuffer(req.body)) {
        return { buffer: req.body, mime: req.headers?.['content-type'] };
    }

    const image =
        typeof req.body?.image === 'string' ? req.body.image.trim() : '';
    if (!image) return { buffer: Buffer.alloc(0) };

    if (image.startsWith('http://') || image.startsWith('https://')) {
        const res = await fetch(image);
        if (!res.ok) {
            throw new Error(`could not fetch the image (${res.status})`);
        }
        return {
            buffer: Buffer.from(await res.arrayBuffer()),
            mime: res.headers.get('content-type') ?? undefined,
        };
    }

    const dataUrl = image.match(/^data:([^;,]+);base64,(.+)$/);
    if (!dataUrl) {
        throw new Error('the image must be a data URL or an http(s) URL');
    }
    return { buffer: Buffer.from(dataUrl[2], 'base64'), mime: dataUrl[1] };
}

/**
 * The upload route, with its own body parsers. Mounted before the global JSON
 * parser; both parsers are declared because either body shape is legitimate, and
 * the one whose Content-Type does not match is a no-op.
 */
export function registerVisionUpload(app: any) {
    const parsers = [
        express.raw({ type: ['image/*'], limit: `${maxImageMb()}mb` }),
        express.json({ limit: `${maxImageMb() * 2}mb` }),
    ];

    app.post(
        `${defaultApiPath}vision/scans`,
        ...parsers,
        async (req: any, res: any) => {
            try {
                if (!visionEnabled()) {
                    res.status(503).json({
                        message: 'The vision module is disabled in the settings.',
                    });
                    return;
                }

                const { buffer, mime } = await uploadBytes(req);
                // Stored as `pending`, read in the background: a vision read
                // takes minutes, so the answer must come back at once and the
                // client follows the record (`GET vision/scans/:id`).
                const scan = await addImageScan(buffer, mime, {
                    type:
                        typeof req.query?.type === 'string'
                            ? req.query.type
                            : undefined,
                    source: scanSource(req.query?.source ?? req.body?.source),
                    user:
                        req.user?.name ??
                        (typeof req.body?.user === 'string'
                            ? req.body.user
                            : undefined),
                });

                res.status(201).json({ scan: publicScan(scan) });
            } catch (e: any) {
                res.status(400).json({ message: e?.message ?? 'the scan failed' });
            }
        }
    );
    console.log('[API] POST', `${defaultApiPath}vision/scans (image upload)`);
}

const routes: RestApis = {
    vision: {
        get: {
            handler: async () => ({
                enabled: visionEnabled(),
                model: visionModelId(),
                keepScans: scansToKeep(),
                maxImageMb: maxImageMb(),
                modules: visionModuleCatalogue(),
            }),
            description:
                'Vision module status, settings and the document types it reads',
        },
    },
    'vision/scans': {
        get: {
            handler: async ({ query }) => ({
                scans: (
                    await listScans({
                        type:
                            typeof query?.type === 'string'
                                ? query.type
                                : undefined,
                        status:
                            typeof query?.status === 'string'
                                ? query.status
                                : undefined,
                        limit: Number(query?.limit) || 20,
                    })
                ).map(publicScan),
            }),
            description: 'Scanned documents, newest first',
            querySchema: {
                type: { type: 'string', required: false },
                status: { type: 'string', required: false },
                limit: { type: 'number', required: false },
            },
        },
    },
    'vision/scans/:id': {
        get: {
            handler: async ({ params }) => {
                const scan = await getScan(params.id);
                return scan ? { scan: publicScan(scan) } : { error: 'not found' };
            },
            description: 'One scanned document, with its extracted data',
        },
        delete: {
            handler: async ({ params }) => ({
                removed: await removeScan(params.id),
            }),
            description: 'Delete a scan and its image',
        },
    },
    'vision/scans/:id/rescan': {
        post: {
            handler: async ({ params, body }) => {
                // Background read, immediate answer: the tab polls the record.
                const scan = await startReading(
                    params.id,
                    typeof body?.type === 'string' ? body.type : undefined
                );
                return scan ? { scan: publicScan(scan) } : { error: 'not found' };
            },
            description:
                'Read the stored image again: a retry, or another document type',
        },
    },
    'vision/scans/:id/image': {
        get: {
            fullHandler: async ({ params }, res: any) => {
                const scan = await getScan(params.id);
                const bytes = scan ? readImage(scan.image) : undefined;
                if (!scan || !bytes) {
                    res.status(404).json({ message: 'image not found' });
                    return;
                }
                res.setHeader('Content-Type', scan.image.mime);
                res.send(bytes);
            },
            description: 'The stored image of a scan',
        },
    },
    'vision/scans/:id/actions/:action': {
        post: {
            handler: async ({ params, body, user }) => {
                return await runScanAction(params.id, params.action, {
                    user:
                        (user as any)?.name ??
                        (typeof body?.user === 'string'
                            ? body.user
                            : undefined),
                });
            },
            description:
                'Run one of the document type’s actions on a scan (e.g. add a recipe to the shopping list)',
        },
    },
};

export default routes;

