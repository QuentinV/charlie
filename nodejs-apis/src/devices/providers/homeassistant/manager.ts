import { RestApis } from '../../../types';
import { HttpError } from '../../../errors';
import {
    haAbortFlow,
    haAdvanceFlow,
    haDeleteEntry,
    haGetEntities,
    haGetFlow,
    haListEntries,
    haListFlowHandlers,
    haRequest,
    haStartFlow,
    haGetStates,
} from './client';
import { cs } from '../../../core/db';
import {
    HA_DEVICE_DOMAINS,
    haStateToDeviceState,
} from './provider';
import { logDeviceState } from '../../history';
import {
    communityEnabled,
    installCommunity,
    listInstalled,
    removeCommunity,
    restartHaAndWait,
    searchCommunity,
} from './community';

// =====================================================================
// Home Assistant integration wizard REST API.
// Proxy for HA's config-flow endpoints so the frontend can add / remove
// device integrations without ever opening the HA UI. Also exposes the
// community (HACS-compatible) installer under /api/ha/community/*.
// =====================================================================

/** Guard community routes behind the feature flag. */
function assertCommunityEnabled(): void {
    if (!communityEnabled()) {
        throw new HttpError(
            403,
            'Home Assistant community integrations are disabled ' +
                '(devices.providers.homeassistant.community.enabled=false).'
        );
    }
}

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
    integrations: {
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
    'integrations/flow/:flow_id': {
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
    'integrations/entry': {
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
    'integrations/entry/:entry_id': {
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
    'integrations/:domain/status': {
        get: {
            handler: async ({ params }) => {
                const domain = params.domain;
                const [handlers, entries, registry, states] =
                    await Promise.all([
                        haListFlowHandlers().catch(() => []),
                        haListEntries().catch(() => []),
                        haGetEntities().catch(() => []),
                        haGetStates().catch(() => []),
                    ]);

                const handlerReady =
                    Array.isArray(handlers) && handlers.includes(domain);
                const configEntries = (entries ?? []).filter(
                    (e: any) => e?.domain === domain
                );
                const platformEntities = (registry ?? []).filter(
                    (e: any) => e?.platform === domain
                );
                const liveEntityIds = new Set(
                    (states ?? [])
                        .map((s: any) => s?.entity_id)
                        .filter((id: any) => typeof id === 'string')
                );
                const charlieEligible = platformEntities.filter((e: any) => {
                    const d = e?.entity_id?.split?.('.')[0];
                    return (
                        d &&
                        HA_DEVICE_DOMAINS.has(d) &&
                        liveEntityIds.has(e.entity_id)
                    );
                });

                return {
                    domain,
                    handlerReady,
                    configured: configEntries.length > 0,
                    configEntries: configEntries.length,
                    entities: platformEntities.length,
                    charlieEligibleEntities: charlieEligible.length,
                };
            },
            description:
                'Diagnose whether an integration is installed/configured and how many entities are eligible for Charlie discovery',
        },
    },
    'entities': {
        get: {
            handler: async ({ query }) => {
                const platform = query?.platform;
                const domainFilter = query?.domain;
                const [registry, states] = await Promise.all([
                    haGetEntities().catch(() => []),
                    haGetStates().catch(() => []),
                ]);

                const stateById = new Map<string, any>(
                    (states ?? [])
                        .filter((s: any) => typeof s?.entity_id === 'string')
                        .map((s: any) => [s.entity_id, s.state])
                );

                const list: any[] = (registry ?? []).map((e: any) => ({
                    entity_id: e?.entity_id,
                    platform: e?.platform,
                    domain: e?.entity_id?.split?.('.')[0],
                }));
                // Include entities that only exist in /api/states (no registry row).
                const known = new Set(list.map((e) => e.entity_id));
                for (const s of states ?? []) {
                    if (
                        typeof s?.entity_id === 'string' &&
                        !known.has(s.entity_id)
                    ) {
                        list.push({
                            entity_id: s.entity_id,
                            platform: undefined,
                            domain: s.entity_id.split('.')[0],
                        });
                    }
                }

                let filtered = list;
                if (platform)
                    filtered = filtered.filter((e) => e.platform === platform);
                if (domainFilter)
                    filtered = filtered.filter((e) => e.domain === domainFilter);

                const withState = filtered.map((e) => ({
                    entity_id: e.entity_id,
                    domain: e.domain,
                    platform: e.platform,
                    state: stateById.has(e.entity_id)
                        ? stateById.get(e.entity_id)
                        : null,
                    hasState: stateById.has(e.entity_id),
                    allowlisted: HA_DEVICE_DOMAINS.has(e.domain),
                }));

                return {
                    platform: platform ?? null,
                    count: withState.length,
                    allowlisted: withState.filter((e) => e.allowlisted).length,
                    withState: withState.filter((e) => e.hasState).length,
                    // Sample of domains present (helps spot allowlist gaps).
                    domains: [
                        ...new Set(withState.map((e) => e.domain)),
                    ].sort(),
                    entities: withState.slice(0, 500),
                };
            },
            description:
                'Inspect HA entities (optionally ?platform= / ?domain=) — shows registry, live state, and whether Charlie would discover them',
        },
    },
    'error-log': {
        get: {
            handler: async ({ query }) => {
                const grep = query?.grep;
                try {
                    const raw = await haRequest('/api/error_log');
                    const text =
                        typeof raw === 'string'
                            ? raw
                            : JSON.stringify(raw ?? '');
                    let lines = text.split('\n');
                    if (grep) lines = lines.filter((l) => l.includes(grep));
                    return { lines: lines.slice(-500) };
                } catch (e) {
                    throw asHttpError(e);
                }
            },
            description:
                "Tail Home Assistant's error log (optionally filtered with ?grep=domain)",
        },
    },
    'resync': {
        post: {
            handler: async () => resyncDevices(),
            description:
                'Refresh states/history of existing Home Assistant devices from HA',
        },
    },
    'community': {
        get: {
            handler: async ({ query }) => {
                assertCommunityEnabled();
                const q = query?.q ?? query?.query ?? '';
                try {
                    return { results: await searchCommunity(q) };
                } catch (e) {
                    throw asHttpError(e);
                }
            },
            description:
                'Search community (HACS-compatible) Home Assistant integrations',
        },
    },
    'community/installed': {
        get: {
            handler: async () => {
                assertCommunityEnabled();
                return { installed: await listInstalled() };
            },
            description: 'List installed community integrations',
        },
    },
    'community/install': {
        post: {
            handler: async ({ body }) => {
                assertCommunityEnabled();
                const { repo, ref } = body ?? {};
                if (!repo || typeof repo !== 'string') {
                    throw new HttpError(400, 'Missing repo');
                }
                try {
                    const result = await installCommunity(repo, ref);
                    // Activate: restart HA so the new config-flow handler is
                    // registered, then wait until it shows up.
                    const restart = await restartHaAndWait(
                        undefined,
                        result.domains
                    );
                    const ready = restart.handlers?.ready !== false;
                    return {
                        ...result,
                        restart,
                        ok: ready,
                        // Be loud instead of showing a green chip when HA never
                        // registered the integration (e.g. wrong HA_CONFIG_DIR,
                        // failed import, or safe mode).
                        ...(ready
                            ? {}
                            : {
                                  warning:
                                      `Home Assistant did not register ` +
                                      `${restart.handlers?.missing?.join(', ') || result.domains.join(', ')} ` +
                                      `after restart. Check that HA_CONFIG_DIR points at HA's ` +
                                      `config directory and inspect Home Assistant's log ` +
                                      `(GET /api/ha/error-log?grep=${result.domain}).`,
                              }),
                    };
                } catch (e) {
                    throw asHttpError(e);
                }
            },
            description:
                'Install a community integration and restart HA to activate it',
        },
    },
    'community/restart': {
        post: {
            handler: async ({ body }) => {
                assertCommunityEnabled();
                const domains: string[] | undefined = body?.domains;
                try {
                    return await restartHaAndWait(undefined, domains);
                } catch (e) {
                    throw asHttpError(e);
                }
            },
            description: 'Restart Home Assistant and wait until it is back',
        },
    },
    'community/:domain': {
        delete: {
            handler: async ({ params }) => {
                assertCommunityEnabled();
                try {
                    return await removeCommunity(params.domain);
                } catch (e) {
                    throw asHttpError(e);
                }
            },
            description:
                'Remove a community integration (restart required to apply)',
        },
    },
};

export default routes;
