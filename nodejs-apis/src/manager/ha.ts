import { RestApis } from '../types';
import { HttpError } from '../errors';
import {
    haAbortFlow,
    haAdvanceFlow,
    haDeleteEntry,
    haGetFlow,
    haListEntries,
    haListFlowHandlers,
    haStartFlow,
    haGetStates,
} from '../core/ha';
import { cs } from '../core/db';
import {
    HA_DEVICE_DOMAINS,
    haStateToDeviceState,
} from '../devices/providers/homeassistant';
import { logDeviceState } from '../devices/history';

// =====================================================================
// Home Assistant integration wizard REST API.
// Proxy for HA's config-flow endpoints so the React frontend can add /
// remove device integrations without ever opening the HA UI.
// =====================================================================

/** Extract HA status + detail from an haRequest failure into an HttpError. */
function asHttpError(e: any, fallbackStatus = 502): HttpError {
    if (e?.isHaError) {
        let detail = e.detail ?? e.message;
        let errors: any;
        try {
            const parsed =
                typeof detail === 'string' ? JSON.parse(detail) : detail;
            if (parsed) {
                if (parsed.message && !errors) detail = parsed.message;
                if (parsed.errors) {
                    errors = parsed.errors;
                    // Prefer a readable base error if present.
                    const base = Array.isArray(parsed.errors.base)
                        ? parsed.errors.base[0]
                        : parsed.errors.base;
                    if (typeof base === 'string') detail = base;
                }
            }
        } catch {
            /* detail is plain text */
        }
        const err = new HttpError(e.status ?? fallbackStatus, detail);
        (err as any).errors = errors;
        return err;
    }
    return new HttpError(fallbackStatus, e?.message ?? 'Home Assistant error');
}

/** Re-apply current HA states to existing Charlie devices (state + history). */
async function resyncDevices(): Promise<{ updated: number }> {
    const provider = await cs.providers.findOne({
        codesource: 'homeassistant',
    });
    if (!provider) return { updated: 0 };

    const states = (await haGetStates()) ?? [];
    let updated = 0;
    for (const entity of states) {
        const entityId = entity?.entity_id;
        if (!entityId?.includes('.')) continue;
        const domain = entityId.split('.')[0];
        if (!HA_DEVICE_DOMAINS.has(domain)) continue;

        const device = await cs.devices.findOne({
            externalId: entityId,
            provider: provider._id,
        });
        if (!device) continue;

        const state = haStateToDeviceState(entity);
        await cs.devices.updateOne({ _id: device._id }, { $set: { state } });
        await logDeviceState({ deviceId: device._id });
        updated += 1;
    }
    return { updated };
}

const routes: RestApis = {
    'ha/integrations': {
        get: {
            handler: async () => haListFlowHandlers(),
            description:
                'List available Home Assistant integrations (flow handlers)',
        },
        post: {
            handler: async ({ body }) => {
                const { handler } = body ?? {};
                if (!handler || typeof handler !== 'string') {
                    throw new HttpError(400, 'Missing handler');
                }
                try {
                    return await haStartFlow(handler);
                } catch (e) {
                    throw asHttpError(e);
                }
            },
            description: 'Start a Home Assistant integration config flow',
        },
    },
    'ha/integrations/flow/:flow_id': {
        get: {
            handler: async ({ params }) => haGetFlow(params.flow_id),
            description: 'Get the current step of an integration config flow',
        },
        post: {
            handler: async ({ params, body }) => {
                // HA's REST flow endpoint validates the whole body against the
                // current step's data_schema, so `step_id` must NOT be sent.
                // Strip it if a legacy client includes it.
                const { step_id, ...userData } = body ?? {};
                try {
                    return await haAdvanceFlow(params.flow_id, userData);
                } catch (e) {
                    throw asHttpError(e);
                }
            },
            description: 'Advance an integration config flow step',
        },
        delete: {
            handler: async ({ params }) => {
                try {
                    return await haAbortFlow(params.flow_id);
                } catch (e) {
                    throw asHttpError(e);
                }
            },
            description: 'Cancel an in-progress integration config flow',
        },
    },
    'ha/integrations/entry': {
        get: {
            handler: async () => {
                try {
                    return await haListEntries();
                } catch (e) {
                    throw asHttpError(e);
                }
            },
            description:
                'List installed Home Assistant integrations (config entries)',
        },
    },
    'ha/integrations/entry/:entry_id': {
        delete: {
            handler: async ({ params }) => {
                try {
                    return await haDeleteEntry(params.entry_id);
                } catch (e) {
                    throw asHttpError(e);
                }
            },
            description: 'Remove a Home Assistant integration (config entry)',
        },
    },
    'ha/resync': {
        post: {
            handler: async () => resyncDevices(),
            description:
                'Refresh states/history of existing Home Assistant devices from HA',
        },
    },
};

export default routes;
