/**
 * The automations event bus.
 *
 * A single, dependency-free in-process emitter. Every "something happened"
 * signal the engine cares about flows through here, so the engine has one place
 * to subscribe and providers have one place to publish (see the hook in
 * `devices/history.ts`). Deliberately a leaf module: nothing it imports may in
 * turn import a publisher, or the graph would never load.
 */
import type { DeviceState, Automation } from '../types';

/**
 * Where a cascade came from, used to bound cross-automation chains: a run
 * started by an event that already carries a taint *continues* it (depth +1)
 * instead of starting fresh, and past a depth limit the chain is refused.
 */
export interface RunTaint {
    /** `<automationId>:<nodeId>` of the very first trigger, or `'manual'`. */
    origin: string;
    depth: number;
}

export type AutomationEvent =
    | { topic: 'cron'; at: number; taint?: RunTaint }
    | { topic: 'manual'; at: number; automationId: string; taint?: RunTaint }
    | {
          topic: 'device-state';
          at: number;
          deviceId: string;
          prev?: DeviceState;
          next?: DeviceState;
          taint?: RunTaint;
      }
    | {
          topic: 'action-completed';
          at: number;
          automationId: string;
          nodeId: string;
          text?: string;
          result?: unknown;
          taint?: RunTaint;
      };

export type AutomationEventListener = (event: AutomationEvent) => void;

const listeners = new Set<AutomationEventListener>();

/** Subscribe to every bus event. Returns an unsubscribe function. */
export function onAutomationEvent(
    listener: AutomationEventListener
): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Publish an event. A misbehaving listener can never break the publisher: each
 * one is isolated, so a device-state update from HA is never lost because an
 * unrelated automation threw.
 */
export function emitAutomationEvent(event: AutomationEvent): void {
    for (const listener of [...listeners]) {
        try {
            listener(event);
        } catch (e) {
            console.error('[automations] event listener failed', e);
        }
    }
}

/** Publish a device-state transition (called once per real change). */
export function emitDeviceStateChange(
    deviceId: string,
    prev: DeviceState | undefined,
    next: DeviceState | undefined
): void {
    emitAutomationEvent({
        topic: 'device-state',
        at: Date.now(),
        deviceId,
        prev,
        next,
    });
}

/** True when an automation has an EVENT trigger listening to this completion. */
export function actionCompletedName(
    automationId: string,
    nodeId: string
): string {
    return `action:${automationId}:${nodeId}`;
}

/** Convenience: the NL text of an action node, for labels/events. */
export function actionLabel(node: Automation['nodes'][number]): string {
    return node.action?.text ?? node.notify?.body ?? node.label ?? node.id;
}
