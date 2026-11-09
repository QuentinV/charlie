/**
 * Automations orchestration.
 *
 * The engine (`./engine.ts`) knows *how* to walk a graph; this module owns
 * *when*: it schedules CRON triggers, subscribes to the event bus, applies the
 * running-lock + per-trigger cooldown + cascade depth that keep an event-driven
 * graph from feeding back on itself, and reloads the cache on CRUD.
 *
 * Always enabled: no feature flag. The list of active automations is the only
 * thing that decides whether anything runs.
 */
import cron from 'node-cron';
import { cs } from '../core/db';
import { Automation, AutomationNode, AutomationTrigger } from '../types';
import { log } from '../manager/services/activities';
import {
    AutomationEvent,
    actionCompletedName,
    onAutomationEvent,
    RunTaint,
} from './events';
import {
    attributedAction,
    changedAttributes,
    recordObservedEffect,
} from './effects';
import {
    execAutomation,
    ExecAutomationResult,
    MAX_CASCADE_DEPTH,
    matchesDeviceStateTrigger,
} from './engine';

/** Active automations, refreshed by `reloadAutomations`. */
const cache: Automation[] = [];

/** Cron handles per automation id. */
const cronJobs: { [automationId: string]: any[] } = {};

/** Cascade lock: an automation ignores triggers while its own run is in flight. */
const running = new Set<string>();

/** Last firing time per `<automationId>:<nodeId>`, for cooldown. */
const lastFired = new Map<string, number>();

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** The completion name an EVENT trigger may target, plus the wildcards. */
function eventNameMatches(
    trigger: AutomationTrigger,
    event: Extract<AutomationEvent, { topic: 'action-completed' }>
): boolean {
    const wanted = trigger.event?.trim();
    if (!wanted) return true; // "any action completed"
    if (wanted === 'action-completed') return true;
    return (
        wanted === actionCompletedName(event.automationId, event.nodeId) ||
        wanted === event.nodeId
    );
}

/** Does this trigger node react to the bus event? */
export function triggerMatches(
    automation: Automation,
    trigger: AutomationTrigger,
    event: AutomationEvent
): boolean {
    if (trigger.type === 'DEVICE_STATE' && event.topic === 'device-state') {
        return matchesDeviceStateTrigger(
            trigger.device,
            event.deviceId,
            event.prev,
            event.next
        );
    }
    if (trigger.type === 'EVENT' && event.topic === 'action-completed') {
        // An automation feeding itself without opting in is exactly the loop we
        // must not start.
        if (event.automationId === automation._id && !trigger.allowSelfTrigger) {
            return false;
        }
        return eventNameMatches(trigger, event);
    }
    return false;
}

const cooldownKey = (automationId: string, nodeId: string) =>
    `${automationId}:${nodeId}`;

/** True when this trigger fired too recently (flapping sensor guard). */
function cooldownActive(
    automationId: string,
    nodeId: string,
    trigger: AutomationTrigger
): boolean {
    const ms = trigger.device?.cooldownMs ?? 0;
    if (!ms) return false;
    const last = lastFired.get(cooldownKey(automationId, nodeId)) ?? 0;
    return Date.now() - last < ms;
}

/** Continue a cascade from an event that already carries a taint. */
function cascadeTaint(event: AutomationEvent): RunTaint {
    const prev = event.taint;
    return { origin: prev?.origin ?? 'event', depth: (prev?.depth ?? -1) + 1 };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Run one automation from a trigger node. Returns `undefined` when it is
 * skipped (already running) or fails — the caller never has to guard.
 */
export async function triggerAutomation(
    automation: Automation,
    startNodeId: string,
    taint?: RunTaint
): Promise<ExecAutomationResult | undefined> {
    const id = automation?._id;
    if (!id) return undefined;

    if (running.has(id)) {
        log('AUTOMATIONS', `Skip "${automation.name}": already running`);
        return undefined;
    }

    running.add(id);
    try {
        const res = await execAutomation(automation, startNodeId, { taint });
        await cs.automations.updateOne(
            { _id: id },
            { $set: { lastRun: new Date() } }
        );
        return res;
    } catch (e) {
        log('AUTOMATIONS', `Run of "${automation.name}" failed`, {
            data: { error: String(e) },
        });
        return undefined;
    } finally {
        running.delete(id);
    }
}

/**
 * Runtime evidence for the house graph: a device-state transition that lands
 * inside an action's correlation window is an effect of that action (see
 * `./effects`). Best effort — a failure here must never break the trigger
 * fan-out below.
 */
function recordDeviceStateEffect(
    event: Extract<AutomationEvent, { topic: 'device-state' }>
): void {
    const action = attributedAction(event.at);
    if (!action) return;

    const changes = changedAttributes(event.prev, event.next);
    for (const [attribute, value] of Object.entries(changes)) {
        void recordObservedEffect({
            automationId: action.automationId,
            nodeId: action.nodeId,
            deviceId: event.deviceId,
            attribute,
            value,
        }).catch(() => undefined);
    }
}

/** Bus subscriber: find every active trigger node that matches the event. */
function onEvent(event: AutomationEvent): void {
    if (event.topic === 'device-state') recordDeviceStateEffect(event);

    for (const automation of cache) {
        if (!automation?._id || !automation.active) continue;

        for (const node of automation.nodes ?? []) {
            if (node.kind !== 'trigger' || !node.trigger) continue;
            if (!triggerMatches(automation, node.trigger, event)) continue;
            if (cooldownActive(automation._id, node.id, node.trigger)) continue;

            const taint = cascadeTaint(event);
            if (taint.depth > MAX_CASCADE_DEPTH) {
                log(
                    'AUTOMATIONS',
                    `Refused "${automation.name}": cascade deeper than ${MAX_CASCADE_DEPTH}`
                );
                continue;
            }

            lastFired.set(cooldownKey(automation._id, node.id), Date.now());
            void triggerAutomation(automation, node.id, taint);
        }
    }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function stopAutomation(id: string): void {
    cronJobs[id]?.forEach((job) => job?.stop?.());
    delete cronJobs[id];
}

/** Schedule every CRON trigger node of one automation. */
export function startAutomation(automation: Automation): void {
    const id = automation?._id;
    if (!id || !automation.active) return;
    stopAutomation(id);

    const jobs: any[] = [];
    for (const node of automation.nodes ?? []) {
        const trigger = node.trigger;
        if (node.kind !== 'trigger') continue;
        if (trigger?.type !== 'CRON' || !trigger.cron?.expression) continue;

        log(
            'AUTOMATIONS',
            `Starting cron ${trigger.cron.expression} for ${automation.name}`
        );
        jobs.push(
            cron.schedule(
                trigger.cron.expression,
                () => {
                    void triggerAutomation(automation, node.id, {
                        origin: `${id}:${node.id}`,
                        depth: 0,
                    });
                },
                { noOverlap: true, timezone: 'Europe/Paris' }
            )
        );
    }

    cronJobs[id] = jobs;
}

/** Re-read the active automations and reschedule everything. */
export async function reloadAutomations(): Promise<void> {
    for (const id of Object.keys(cronJobs)) stopAutomation(id);
    cache.length = 0;

    const list = await cs.automations.find({ active: true }).toArray();
    cache.push(...list);
    list.forEach((automation: Automation) => startAutomation(automation));
}

/** Boot entry point: subscribe once, then load. */
export async function setupAutomations(): Promise<void> {
    subscribeOnce();
    await reloadAutomations();
}

let subscribed = false;
function subscribeOnce(): void {
    if (subscribed) return;
    onAutomationEvent(onEvent);
    subscribed = true;
}

/** REST "run now": from an explicit node, a MANUAL trigger, else the first. */
export async function runAutomationById(
    id: string,
    nodeId?: string
): Promise<{ ran: boolean; error?: string; executed?: string[] }> {
    const automation: Automation | null = await cs.automations.findOne({
        _id: id,
    });
    if (!automation) return { ran: false, error: 'not found' };

    const nodes: AutomationNode[] = automation.nodes ?? [];
    const start =
        nodeId ??
        nodes.find((n) => n.kind === 'trigger' && n.trigger?.type === 'MANUAL')
            ?.id ??
        nodes.find((n) => n.kind === 'trigger')?.id;

    if (!start) return { ran: false, error: 'no trigger' };

    const res = await triggerAutomation(automation, start, {
        origin: 'manual',
        depth: 0,
    });
    if (!res) return { ran: false, error: 'already running' };
    return { ran: true, executed: res.executed };
}


