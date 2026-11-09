/**
 * The house graph.
 *
 * One picture of cause and effect across every automation. A **state** node is a
 * *definition*: one node per `device · attribute`, shared by everyone who
 * watches it or writes it. Five automations watching the same lamp collapse into
 * one node, and an effect that produces that state lands on the node that
 * already exists.
 *
 * The **value** of a transition rides on the arc (`on`, `off`, `≠ on`, `~`),
 * never on the node — identity is the state, not the instance. That is what makes
 * a loop visible: an action that produces a state which triggers an automation
 * closes the circuit in the picture, which is exactly the feedback the engine's
 * cascade depth and cooldowns exist to contain (hence the `cycle` flag).
 *
 * Pure: no I/O, no `cs`. The route reads the collections and hands them over, so
 * every rule here is unit-testable.
 */
import {
    Automation,
    AutomationEdge,
    AutomationEffect,
    AutomationNode,
    Device,
    DeviceStateTrigger,
    PropertyValue,
} from '../types';

export type GraphNodeKind =
    | 'state' // a `device · attribute` definition
    | 'schedule' // a CRON trigger
    | 'manual' // run from the UI / REST
    | 'event' // an action-completed trigger
    | 'condition' // a gate
    | 'action' // a natural-language action
    | 'notify'; // a push notification

export interface GraphNode {
    id: string;
    kind: GraphNodeKind;
    label: string;
    /** The automation that declared it (state nodes are shared: optional). */
    automationId?: string;
    automationName?: string;
    /** The stored node id, for step nodes. */
    nodeId?: string;
    /** State nodes only: the definition they stand for. */
    deviceId?: string;
    attribute?: string;
    /** State nodes only: the transitions seen through it (`on`, `off`, `~`). */
    values?: string[];
    /** State nodes only: how many automations watch this definition. */
    watches?: number;
    /** State nodes only: how many observed arcs produced it. */
    effects?: number;
}

export interface GraphEdge {
    id: string;
    from: string;
    to: string;
    kind: 'flow' | 'effect' | 'listens';
    automationId?: string;
    when?: AutomationEdge['when'];
    /** The transition this arc carries: `on`, `off`, `≠ on`, `~`. */
    label?: string;
    /** `effect` arcs only: how many times seen, and when last. */
    count?: number;
    lastAt?: number;
    /** Both ends belong to a cycle (red in the UI). */
    cycle?: boolean;
}

export interface HouseGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
    stats: {
        automations: number;
        states: number;
        actions: number;
        effects: number;
        cycles: number;
    };
}

/**
 * A state definition's key: one node per `device · attribute`. The *value* is
 * deliberately absent — an action that produces `power = on` on a device already
 * watched on `power = off` must land on that same node, which is what closes a
 * loop in the picture instead of drawing a parallel node.
 */
export const stateKey = (deviceId: string, attribute: string): string =>
    `${deviceId}|${attribute}`;

const stateNodeId = (key: string): string => `st:${key}`;
const triggerNodeId = (automationId: string, nodeId: string): string =>
    `tr:${automationId}:${nodeId}`;
const stepNodeId = (automationId: string, nodeId: string): string =>
    `nd:${automationId}:${nodeId}`;

/** The transition a DEVICE_STATE trigger watches: `enter`→to, `leave`→from, `change`→*. */
export function triggerStateValue(
    trigger: DeviceStateTrigger
): PropertyValue | '*' {
    const edge = trigger.edge ?? 'enter';
    if (edge === 'change') return '*';
    if (edge === 'leave') return trigger.from ?? '*';
    return trigger.to ?? '*';
}

/** How that transition reads on the arc leaving the definition. */
export function triggerEdgeLabel(trigger: DeviceStateTrigger): string {
    const edge = trigger.edge ?? 'enter';
    if (edge === 'change') return '~';
    if (edge === 'leave') return `≠ ${String(trigger.from ?? '*')}`;
    return String(trigger.to ?? '*');
}

/** The transitions a definition's subtitle lists (concrete ones only). */
export function triggerFlowValue(
    trigger: DeviceStateTrigger
): string | undefined {
    const edge = trigger.edge ?? 'enter';
    if (edge === 'change') return '~';
    if (edge === 'leave') return undefined; // the arc carries `≠ x`: no target
    return trigger.to === undefined ? undefined : String(trigger.to);
}

/** Graph node id of a stored node (state definitions are shared, so resolved). */
const graphNodeIdFor = (automationId: string, node: AutomationNode): string =>
    node.kind === 'trigger'
        ? triggerNodeId(automationId, node.id)
        : stepNodeId(automationId, node.id);

/** Label of a step node (action text, notify body, condition gate). */
export function stepLabel(
    node: AutomationNode,
    deviceName: Map<string, string>
): string {
    if (node.kind === 'action') return node.action?.text?.trim() || node.id;
    if (node.kind === 'notify') return node.notify?.body?.trim() || 'notify';
    if (node.kind === 'condition') {
        const condition = node.condition;
        if (!condition) return node.label ?? node.id ?? 'condition';
        const device = deviceName.get(condition.deviceId) ?? condition.deviceId;
        const value = Array.isArray(condition.value)
            ? condition.value.join('-')
            : String(condition.value ?? '');
        return `${device} · ${condition.attribute} ${condition.op} ${value}`.trim();
    }
    return node.label ?? node.id;
}

/** Label of a non-DEVICE_STATE trigger node. */
export function triggerLabel(node: AutomationNode): string {
    const trigger = node.trigger;
    if (trigger?.type === 'CRON') {
        return `⏰ ${trigger.cron?.expression ?? ''}`.trim();
    }
    if (trigger?.type === 'EVENT') {
        return `↳ ${trigger.event || 'action terminée'}`;
    }
    return '▶ manuel';
}

/** A definition reads as `device · attribute` — never with a value. */
const stateLabel = (
    deviceName: Map<string, string>,
    deviceId: string,
    attribute: string
): string => `${deviceName.get(deviceId) ?? deviceId} · ${attribute}`;

/** A definition as gathered from the triggers and the observed effects. */
interface StateDef {
    deviceId: string;
    attribute: string;
    watches: number;
    effects: number;
    values: Set<string>;
}

/** An observed arc kept until the definitions exist. */
interface PendingEffect {
    id: string;
    automationId: string;
    nodeId: string;
    deviceId: string;
    attribute: string;
    value: PropertyValue;
    count: number;
    lastAt: number;
}

/**
 * Build the whole-house graph. `effects` are the observed arcs — possibly stale
 * after an edit, in which case an arc whose action no longer exists is skipped.
 */
export function buildHouseGraph(
    automations: Automation[] = [],
    effects: AutomationEffect[] = [],
    devices: Device[] = []
): HouseGraph {
    const deviceName = new Map(
        (devices ?? []).map((device) => [String(device._id), device.name])
    );

    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const edgeIds = new Set<string>();

    const putNode = (node: GraphNode): void => {
        const existing = nodes.get(node.id);
        if (!existing) {
            nodes.set(node.id, node);
            return;
        }
        // A shared definition aggregates watchers, producers and values.
        existing.watches = (existing.watches ?? 0) + (node.watches ?? 0);
        existing.effects = (existing.effects ?? 0) + (node.effects ?? 0);
        existing.values = [
            ...new Set([...(existing.values ?? []), ...(node.values ?? [])]),
        ];
    };
    const putEdge = (edge: GraphEdge): void => {
        if (edgeIds.has(edge.id)) return;
        edgeIds.add(edge.id);
        edges.push(edge);
    };

    /** Definitions, keyed `device·attribute` — never by value. */
    const states = new Map<string, StateDef>();
    /** `<automationId>:<nodeId>` → graph id (a definition for DEVICE_STATE). */
    const stepId = new Map<string, string>();
    /** `<automationId>:<nodeId>` of every declared node (the stale-effect guard). */
    const known = new Set<string>();

    const definitionOf = (deviceId: string, attribute: string): StateDef => {
        const key = stateKey(deviceId, attribute);
        const existing = states.get(key);
        if (existing) return existing;
        const created: StateDef = {
            deviceId,
            attribute,
            watches: 0,
            effects: 0,
            values: new Set<string>(),
        };
        states.set(key, created);
        return created;
    };

    // --- declared structure: the shared definitions, counted ---------------
    for (const automation of automations ?? []) {
        const automationId = automation._id;
        if (!automationId) continue;

        for (const node of automation.nodes ?? []) {
            known.add(`${automationId}:${node.id}`);
            const deviceTrigger =
                node.kind === 'trigger' &&
                node.trigger?.type === 'DEVICE_STATE' &&
                node.trigger.device;
            if (deviceTrigger) {
                const device = node.trigger!.device!;
                const definition = definitionOf(
                    device.deviceId,
                    device.attribute
                );
                definition.watches += 1;
                const value = triggerFlowValue(device);
                if (value !== undefined) definition.values.add(value);
                stepId.set(
                    `${automationId}:${node.id}`,
                    stateNodeId(stateKey(device.deviceId, device.attribute))
                );
            } else {
                stepId.set(
                    `${automationId}:${node.id}`,
                    graphNodeIdFor(automationId, node)
                );
            }
        }
    }

    // --- observed effects merge into those very definitions ----------------
    const pending: PendingEffect[] = [];
    for (const effect of effects ?? []) {
        if (!known.has(`${effect.automationId}:${effect.nodeId}`)) continue;
        const definition = definitionOf(effect.deviceId, effect.attribute);
        definition.effects += 1;
        definition.values.add(String(effect.value));
        pending.push({
            id: effect._id,
            automationId: effect.automationId,
            nodeId: effect.nodeId,
            deviceId: effect.deviceId,
            attribute: effect.attribute,
            value: effect.value,
            count: effect.count ?? 1,
            lastAt: effect.lastAt,
        });
    }

    // --- the definitions themselves ---------------------------------------
    for (const [key, definition] of states) {
        putNode({
            id: stateNodeId(key),
            kind: 'state',
            label: stateLabel(
                deviceName,
                definition.deviceId,
                definition.attribute
            ),
            deviceId: definition.deviceId,
            attribute: definition.attribute,
            values: [...definition.values].sort().slice(0, 4),
            watches: definition.watches || undefined,
            effects: definition.effects || undefined,
        });
    }

    // --- declared structure: step nodes + labelled flow arcs ---------------
    for (const automation of automations ?? []) {
        const automationId = automation._id;
        if (!automationId) continue;

        for (const node of automation.nodes ?? []) {
            if (node.kind === 'trigger') {
                const type = node.trigger?.type;
                if (type === 'DEVICE_STATE') continue; // already a definition
                putNode({
                    id: triggerNodeId(automationId, node.id),
                    kind:
                        type === 'CRON'
                            ? 'schedule'
                            : type === 'EVENT'
                            ? 'event'
                            : 'manual',
                    label: triggerLabel(node),
                    automationId,
                    automationName: automation.name,
                    nodeId: node.id,
                });
                continue;
            }
            putNode({
                id: stepNodeId(automationId, node.id),
                kind: node.kind,
                label: stepLabel(node, deviceName),
                automationId,
                automationName: automation.name,
                nodeId: node.id,
            });
        }

        for (const edge of automation.edges ?? []) {
            const from = stepId.get(`${automationId}:${edge.from}`);
            const to = stepId.get(`${automationId}:${edge.to}`);
            if (!from || !to) continue; // dangling edge: never drawn
            const source = (automation.nodes ?? []).find(
                (node) => node.id === edge.from
            );
            const device =
                source?.kind === 'trigger' &&
                source.trigger?.type === 'DEVICE_STATE'
                    ? source.trigger.device
                    : undefined;
            putEdge({
                id: `flow:${automationId}:${edge.from}>${edge.to}`,
                from,
                to,
                kind: 'flow',
                automationId,
                when: edge.when,
                // The transition the trigger watches rides on the arc.
                label: device ? triggerEdgeLabel(device) : undefined,
            });
        }
    }

    // --- observed effects: the arc that closes a loop lands on the definition
    for (const effect of pending) {
        putEdge({
            id: `effect:${effect.id}`,
            from: stepNodeId(effect.automationId, effect.nodeId),
            to: stateNodeId(stateKey(effect.deviceId, effect.attribute)),
            kind: 'effect',
            automationId: effect.automationId,
            label: String(effect.value),
            count: effect.count,
            lastAt: effect.lastAt,
        });
    }

    // --- EVENT triggers listening to a precise action completion ------------
    for (const automation of automations ?? []) {
        const automationId = automation._id;
        if (!automationId) continue;

        for (const node of automation.nodes ?? []) {
            if (node.kind !== 'trigger' || node.trigger?.type !== 'EVENT') {
                continue;
            }
            const match = node.trigger.event
                ?.trim()
                .match(/^action:([^:]+):(.+)$/);
            if (!match) continue; // wildcard: nothing precise to point at
            const [, targetAutomation, targetNode] = match;
            const from = stepId.get(`${automationId}:${node.id}`);
            if (!from || !known.has(`${targetAutomation}:${targetNode}`)) {
                continue;
            }
            putEdge({
                id: `listens:${automationId}:${node.id}`,
                from,
                to: stepNodeId(targetAutomation, targetNode),
                kind: 'listens',
                automationId,
            });
        }
    }

    // --- cycles: an arc whose target can reach back to its source -----------
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
        const list = adjacency.get(edge.from) ?? [];
        list.push(edge.to);
        adjacency.set(edge.from, list);
    }
    const reaches = (start: string, goal: string): boolean => {
        const seen = new Set<string>([start]);
        const queue = [start];
        while (queue.length) {
            const current = queue.shift() as string;
            for (const next of adjacency.get(current) ?? []) {
                if (next === goal) return true;
                if (seen.has(next)) continue;
                seen.add(next);
                queue.push(next);
            }
        }
        return false;
    };
    let cycles = 0;
    for (const edge of edges) {
        if (edge.from === edge.to || reaches(edge.to, edge.from)) {
            edge.cycle = true;
            cycles += 1;
        }
    }

    const all = [...nodes.values()];
    return {
        nodes: all,
        edges,
        stats: {
            automations: (automations ?? []).filter((a) => a._id).length,
            states: all.filter((node) => node.kind === 'state').length,
            actions: all.filter((node) => node.kind === 'action').length,
            effects: edges.filter((edge) => edge.kind === 'effect').length,
            cycles,
        },
    };
}



