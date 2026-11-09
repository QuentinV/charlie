/**
 * Observed action effects.
 *
 * The house graph's `action → state` arcs are **evidence, never a static
 * guess**: when the engine runs an action it opens a correlation window, and
 * every device-state transition landing inside it is recorded as an effect of
 * that action (`automation_effects`).
 *
 * Attribution is twofold:
 *
 *   * the **async context** first — the engine runs each action inside
 *     `runWithAction`, and since `changeDeviceState` announces its own writes
 *     from within that chain, the action that caused a transition is known
 *     exactly, for every provider;
 *   * a short **time window** as a fallback, for a gateway that reports back on
 *     another chain (HA's `state_changed` arrives on the websocket, after the
 *     service call returned).
 *
 * The fallback is deliberately short: a change made by hand near a running
 * action must not be credited to it.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { cs } from '../core/db';
import { DeviceState, PropertyValue } from '../types';

/**
 * How long after an action starts (and again after it completes) a device write
 * is still credited to it, when the write is reported on another async chain.
 */
export const ACTION_SETTLE_MS = 1500;

/** The action node currently executing, carried across `await` boundaries. */
interface ActionContext {
    automationId: string;
    nodeId: string;
}

const actionContext = new AsyncLocalStorage<ActionContext>();

/**
 * Run an action inside its own context. Everything the action triggers —
 * including the state bus emit done by `changeDeviceState` — sees it, so an
 * effect is attributed to the exact node instead of to a stopwatch.
 */
export function runWithAction<T>(
    automationId: string,
    nodeId: string,
    fn: () => Promise<T>
): Promise<T> {
    return actionContext.run({ automationId, nodeId }, fn);
}

/** The action node being executed, when there is one. */
export function currentAction(): ActionContext | undefined {
    return actionContext.getStore();
}


/** Canonical attributes, recorded alongside every `properties` key. */
const CANONICAL = ['power', 'level'] as const;

interface Window {
    automationId: string;
    nodeId: string;
    startedAt: number;
    until: number;
}

/** Open correlation windows, keyed `<automationId>:<nodeId>`. */
const windows = new Map<string, Window>();

const keyOf = (automationId: string, nodeId: string): string =>
    `${automationId}:${nodeId}`;

/** An action node is about to run: its window opens. */
export function noteActionStarted(
    automationId: string,
    nodeId: string,
    now = Date.now()
): void {
    windows.set(keyOf(automationId, nodeId), {
        automationId,
        nodeId,
        startedAt: now,
        until: now + ACTION_SETTLE_MS,
    });
}

/** An action finished: keep crediting it for a while (the gateway write-back). */
export function noteActionSettled(
    automationId: string,
    nodeId: string,
    now = Date.now()
): void {
    const window = windows.get(keyOf(automationId, nodeId));
    if (window) window.until = Math.max(window.until, now + ACTION_SETTLE_MS);
}

/**
 * The action a device-state transition at `at` belongs to: the exact one when the
 * transition happened inside an action's async context, else the most recently
 * started window still open. When two windows overlap the freshest cause is the
 * likeliest one; expired windows are dropped as they are met.
 */
export function attributedAction(
    at: number
): { automationId: string; nodeId: string } | undefined {
    const exact = currentAction();
    if (exact) return { automationId: exact.automationId, nodeId: exact.nodeId };

    let best: Window | undefined;
    for (const [key, window] of windows) {
        if (window.until < at) {
            windows.delete(key);
            continue;
        }
        if (at < window.startedAt || at > window.until) continue;
        if (!best || window.startedAt > best.startedAt) best = window;
    }
    return best
        ? { automationId: best.automationId, nodeId: best.nodeId }
        : undefined;
}

/** Tests only: drop every open window. */
export function resetEffectWindows(): void {
    windows.clear();
}

const isUnavailable = (value: unknown): boolean =>
    value === null ||
    value === undefined ||
    value === 'unavailable' ||
    value === 'unknown';

/**
 * The attributes whose value really changed in this transition. The *same* edge
 * detection a trigger uses, so an observed effect can only ever close a loop it
 * would actually fire — and an `unavailable` reading is never recorded.
 */
export function changedAttributes(
    prev: DeviceState | undefined,
    next: DeviceState | undefined
): Record<string, PropertyValue> {
    const changed: Record<string, PropertyValue> = {};
    if (!next) return changed;

    for (const attribute of CANONICAL) {
        const before = prev?.[attribute];
        const after = next[attribute];
        if (after === undefined || isUnavailable(after)) continue;
        if (before === after) continue;
        changed[attribute] = after;
    }

    for (const [name, after] of Object.entries(next.properties ?? {})) {
        const before = prev?.properties?.[name];
        if (after === undefined || isUnavailable(after)) continue;
        if (before === after) continue;
        changed[name] = after;
    }

    return changed;
}

/** Stable id of one observed arc, so re-observations only bump the count. */
export const effectId = (
    automationId: string,
    nodeId: string,
    deviceId: string,
    attribute: string,
    value: PropertyValue
): string =>
    `${automationId}:${nodeId}|${deviceId}|${attribute}|${String(value)}`;

/** Persist one observed `action → state` arc (idempotent, counted over time). */
export async function recordObservedEffect(input: {
    automationId: string;
    nodeId: string;
    deviceId: string;
    attribute: string;
    value: PropertyValue;
}): Promise<void> {
    const now = Date.now();
    await cs.automationEffects.updateOne(
        {
            _id: effectId(
                input.automationId,
                input.nodeId,
                input.deviceId,
                input.attribute,
                input.value
            ),
        },
        {
            $inc: { count: 1 },
            $set: { lastAt: now },
            $setOnInsert: { ...input, firstAt: now },
        },
        { upsert: true }
    );
}
