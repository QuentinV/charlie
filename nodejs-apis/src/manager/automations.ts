import { cs } from '../core/db';
import { RestApis } from '../types';
import { v4 as uuidV4 } from 'uuid';
import { reloadAutomations, runAutomationById } from '../automations';
import { buildHouseGraph } from '../automations/graph';
import { composeAutomation } from '../automations/compose';
import { log } from './services/activities';

const routes: RestApis = {
    automations: {
        get: async () => cs.automations.find().toArray(),
        post: async ({ body }) => {
            const { _id, name, active, nodes, edges } = body ?? {};
            const uuid = _id || uuidV4();
            await cs.automations.updateOne(
                { _id: uuid },
                {
                    $set: {
                        _id: uuid,
                        name: name ?? '',
                        active: active !== false,
                        nodes: nodes ?? [],
                        edges: edges ?? [],
                    },
                },
                { upsert: true }
            );

            // A change can add/remove a CRON trigger or flip the active flag:
            // rebuild the schedule from the DB so the running set matches.
            await reloadAutomations();

            return { uuid };
        },
    },
    'automations/compose': {
        post: async ({ body }) => {
            const text = body?.text;
            if (!text?.trim()) {
                return { error: 'text is required' };
            }
            const devices = await cs.devices.find().toArray();
            try {
                // The draft has no `_id` yet, so the house-graph builder would
                // skip it and draw nothing: the preview reads the nodes instead.
                return await composeAutomation(text, devices);
            } catch (e) {
                log('AUTOMATIONS', 'Compose failed', {
                    data: { error: String(e) },
                });
                return { error: String((e as any)?.message ?? e) };
            }
        },
    },
    'automations/graph': {
        get: async () => {
            const [automations, effects, devices] = await Promise.all([
                cs.automations.find().toArray(),
                cs.automationEffects.find().toArray(),
                cs.devices.find().toArray(),
            ]);
            return buildHouseGraph(automations, effects, devices);
        },
    },
    'automations/:id': {
        get: async ({ params }) => cs.automations.findOne({ _id: params.id }),
        delete: async ({ params }) => {
            await cs.automations.deleteOne({ _id: params.id });
            // Observed effects belong to the automation: keeping them would only
            // draw orphan arcs in the graph.
            await cs.automationEffects.deleteMany({
                automationId: params.id,
            });
            await reloadAutomations();
        },
    },
    'automations/:id/run': {
        post: async ({ params, body }) =>
            runAutomationById(params.id, body?.nodeId),
    },
    'automations/:id/toggle': {
        post: async ({ params }) => {
            const automation = await cs.automations.findOne({
                _id: params.id,
            });
            const active = !automation?.active;
            await cs.automations.updateOne(
                { _id: params.id },
                { $set: { active } }
            );
            await reloadAutomations();
            return { active };
        },
    },
};

export default routes;
