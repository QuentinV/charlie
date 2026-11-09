/**
 * The automations engine.
 *
 * Two layers, on purpose:
 *   * pure helpers (`attributeValue`, `matchesDeviceStateTrigger`,
 *     `evaluateCondition`, `edgeApplies`) — no I/O, exhaustively unit-tested;
 *   * the walker (`execAutomation`) — follows the graph from a fired trigger,
 *     running action / notify / condition nodes through an injectable runner
 *     (the real one calls `ask()`), so the traversal is testable too.
 *
 * The engine never schedules and never owns the running-lock/cooldown: that
 * orchestration lives in `./index.ts`, which is the one entry point the bus and
 * the REST layer call.
 */
import { ask } from '../ai/flow';
import { sendPushNotifcation } from '../core/notifications';
import { cs } from '../core/db';
import { log } from '../manager/services/activities';
import {
    Automation,
    AutomationEdge,
    AutomationNode,
    ConditionDef,
    DeviceState,
    DeviceStateTrigger,
    PropertyValue,
} from '../types';
import {
    actionLabel,
    emitAutomationEvent,
    RunTaint,
} from './events';
import {
    noteActionSettled,
    noteActionStarted,
    runWithAction,
} from './effects';

/** Longest chain an action may cascade into, across automations. */
export const MAX_CASCADE_DEPTH = 8;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Read a watched attribute off a device state (`power` / `level` / a property). */
export function attributeValue(
    state: DeviceState | undefined,
    attribute: string
): PropertyValue | undefined {
    if (!state) return undefined;
    if (attribute === 'power') return state.power;
    if (attribute === 'level') return state.level;
    return state.properties?.[attribute];
}

const sameValue = (a: unknown, b: unknown): boolean => {
    if (a === undefined || b === undefined) return a === b;
    if (typeof a === 'number' || typeof b === 'number') {
        return Number(a) === Number(b);
    }
    return a === b;
};

/** A value the gateway reports when it cannot read the device — never a target. */
const isUnavailable = (v: unknown): boolean =>
    v === null || v === undefined || v === 'unavailable' || v === 'unknown';

/**
 * Does a device-state transition fire this trigger?
 *
 * Fires on a real *transition*, never a level: `next` must differ from `prev`
 * (so a re-read of a stable value is not an event), and the target value must
 * be readable. `to`/`from` are compared with loose number equality so a JSON
 * `"1"` and a `1` do not silently miss.
 */
export function matchesDeviceStateTrigger(
    trigger: DeviceStateTrigger | undefined,
    deviceId: string,
    prev: DeviceState | undefined,
    next: DeviceState | undefined
): boolean {
    if (!trigger) return false;
    if (trigger.deviceId !== deviceId) return false;

    const before = attributeValue(prev, trigger.attribute);
    const after = attributeValue(next, trigger.attribute);

    // No real change on the watched attribute → not an event (edge detection).
    if (sameValue(before, after)) return false;
    // The device went offline / became unknown: never a target value.
    if (isUnavailable(after) && trigger.edge !== 'leave') return false;

    switch (trigger.edge ?? 'enter') {
        case 'change':
            return true;
        case 'leave':
            return trigger.from === undefined
                ? true
                : sameValue(before, trigger.from);
        case 'enter':
        default:
            if (trigger.to === undefined) return true;
            return sameValue(after, trigger.to);
    }
}

/** Evaluate a condition node against a device state. Defaults to `true`. */
export function evaluateCondition(
    condition: ConditionDef | undefined,
    state: DeviceState | undefined
): boolean {
    if (!condition) return true;
    const current = attributeValue(state, condition.attribute);
    if (current === undefined) return false;

    const { op, value } = condition;
    switch (op) {
        case 'eq':
            return sameValue(current, value);
        case 'neq':
            return !sameValue(current, value);
        case 'between': {
            const [min, max] = Array.isArray(value) ? value : [value, value];
            const n = Number(current);
            return (
                Number.isFinite(n) &&
                Number.isFinite(Number(min)) &&
                Number.isFinite(Number(max)) &&
                n >= Number(min) &&
                n <= Number(max)
            );
        }
        case 'gt':
            return Number(current) > Number(value);
        case 'lt':
            return Number(current) < Number(value);
        default:
            return false;
    }
}

/** Whether an edge is followed, given the source node's result. */
export function edgeApplies(
    when: AutomationEdge['when'],
    lastResult: unknown
): boolean {
    const truthy = !!lastResult && lastResult !== null;
    switch (when) {
        case 'success':
            return truthy;
        case 'failure':
            return !truthy;
        case 'always':
        default:
            return true;
    }
}

/** Outgoing adjacency for a graph. */
export function indexEdges(
    edges: AutomationEdge[] | undefined
): { out: Map<string, AutomationEdge[]> } {
    const out = new Map<string, AutomationEdge[]>();
    for (const edge of edges ?? []) {
        const list = out.get(edge.from) ?? [];
        list.push(edge);
        out.set(edge.from, list);
    }
    return { out };
}

// ---------------------------------------------------------------------------
// Walker
// ---------------------------------------------------------------------------

/** Runs one node; returns its result (drives `when` gating / condition pruning). */
export type NodeRunner = (
    node: AutomationNode,
    automation: Automation,
    taint: RunTaint
) => Promise<unknown>;

export interface ExecAutomationOptions {
    /** Continue a cascade instead of starting one (cross-automation chains). */
    taint?: RunTaint;
    /** Injectable for tests; defaults to the real `ask()` / push runner. */
    run?: NodeRunner;
    /** Injectable clock. */
    now?: number;
}

export interface ExecAutomationResult {
    /** Node ids actually executed, in order. */
    executed: string[];
    /** Node ids reached but skipped (edge gate / visited). */
    skipped: string[];
    taint: RunTaint;
}

/**
 * Walk the graph from `startNodeId` (a trigger node), executing every reachable
 * node. Within one run a node runs at most once (loop guard); a trigger node is
 * never executed as an action. A false condition node prunes its whole subtree.
 */
export async function execAutomation(
    automation: Automation,
    startNodeId: string,
    options?: ExecAutomationOptions
): Promise<ExecAutomationResult> {
    const run = options?.run ?? defaultRunner;
    const now = options?.now ?? Date.now();
    const taint: RunTaint = options?.taint ?? {
        origin: `${automation._id ?? automation.name}:${startNodeId}`,
        depth: 0,
    };

    const nodesById = new Map((automation.nodes ?? []).map((n) => [n.id, n]));
    const { out } = indexEdges(automation.edges);
    const results = new Map<string, unknown>();
    const executed: string[] = [];
    const skipped: string[] = [];

    const walk = async (fromId: string): Promise<void> => {
        const lastResult = results.get(fromId);
        for (const edge of out.get(fromId) ?? []) {
            const child = nodesById.get(edge.to);
            if (!child) continue;
            // Triggers only start a run; they are not executable steps.
            if (child.kind === 'trigger') continue;
            if (executed.includes(child.id)) {
                skipped.push(child.id); // already run in this cascade
                continue;
            }
            if (!edgeApplies(edge.when, lastResult)) {
                skipped.push(child.id);
                continue;
            }
            
            const isAction = child.kind === 'action';
            if (isAction) noteActionStarted(automation._id ?? '', child.id);

            let result: unknown;
            try {
                const execute = () => run(child, automation, taint);
                result = isAction
                    ? await runWithAction(
                          automation._id ?? '',
                          child.id,
                          execute
                      )
                    : await execute();
            } finally {
                if (isAction) {
                    noteActionSettled(automation._id ?? '', child.id);
                }
            }

            results.set(child.id, result);
            executed.push(child.id);

            if (child.kind === 'action' || child.kind === 'notify') {
                log('AUTOMATIONS', `Ran "${actionLabel(child)}"`, {
                    context: { automation: automation._id, node: child.id },
                });
                emitAutomationEvent({
                    topic: 'action-completed',
                    at: now,
                    automationId: automation._id ?? '',
                    nodeId: child.id,
                    text: actionLabel(child),
                    result,
                    taint,
                });
            }

            // A false condition prunes its whole subtree, whatever the edge says.
            if (child.kind === 'condition' && !result) {
                continue;
            }

            await walk(child.id);
        }
    };

    await walk(startNodeId);

    return { executed, skipped, taint };
}

/** The real runner: NL actions go through the existing `ask()`, unchanged. */
export const defaultRunner: NodeRunner = async (node) => {
    switch (node.kind) {
        case 'action': {
            const text = node.action?.text?.trim();
            if (!text) return false;
            return ask(text, { log: true });
        }
        case 'notify': {
            const body = node.notify?.body?.trim();
            if (!body) return false;
            await sendPushNotifcation({
                title: node.notify?.title ?? 'Charlie',
                body,
            });
            return true;
        }
        case 'condition': {
            const def = node.condition;
            if (!def) return true;
            const device = await cs.devices.findOne({ _id: def.deviceId });
            return evaluateCondition(def, device?.state);
        }
        default:
            return true;
    }
};

