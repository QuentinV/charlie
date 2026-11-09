/**
 * Automations engine — the pure core (matching, conditions, edge gating).
 *
 * The heavy collaborators are mocked so importing the engine never boots the
 * LLM / memory timers.
 */
jest.mock('../../ai/flow', () => ({ ask: jest.fn() }));
jest.mock('../../core/notifications', () => ({
    sendPushNotifcation: jest.fn(),
}));
jest.mock('../../manager/services/activities', () => ({ log: jest.fn() }));
jest.mock('../../core/db', () => ({
    cs: { devices: { findOne: jest.fn() } },
}));

import {
    attributeValue,
    edgeApplies,
    evaluateCondition,
    execAutomation,
    indexEdges,
    matchesDeviceStateTrigger,
    NodeRunner,
} from '../engine';
import { onAutomationEvent } from '../events';
import { Automation, AutomationNode } from '../../types';

const node = (
    id: string,
    kind: AutomationNode['kind'],
    extra: Partial<AutomationNode> = {}
): AutomationNode => ({ id, kind, ...extra });

const automation = (
    nodes: AutomationNode[],
    edges: Automation['edges']
): Automation => ({ _id: 'a1', name: 'test', active: true, nodes, edges });

describe('attributeValue', () => {
    it('reads power, level and a free property', () => {
        const state = {
            power: 'on' as const,
            level: 42,
            properties: { source: 'tv' },
        };
        expect(attributeValue(state, 'power')).toBe('on');
        expect(attributeValue(state, 'level')).toBe(42);
        expect(attributeValue(state, 'source')).toBe('tv');
        expect(attributeValue(state, 'missing')).toBeUndefined();
        expect(attributeValue(undefined, 'power')).toBeUndefined();
    });
});

describe('matchesDeviceStateTrigger', () => {
    const base = { deviceId: 'd1', attribute: 'power' };

    it('fires on entering the target value', () => {
        expect(
            matchesDeviceStateTrigger(
                { ...base, to: 'on' },
                'd1',
                { power: 'off' },
                { power: 'on' }
            )
        ).toBe(true);
    });

    it('does not fire on an unchanged value (a re-read is not an event)', () => {
        expect(
            matchesDeviceStateTrigger(
                { ...base, to: 'on' },
                'd1',
                { power: 'on' },
                { power: 'on' }
            )
        ).toBe(false);
    });

    it('does not fire when the target is not the new value', () => {
        expect(
            matchesDeviceStateTrigger(
                { ...base, to: 'on' },
                'd1',
                { power: 'off' },
                { power: 'pause' }
            )
        ).toBe(false);
    });

    it('ignores unavailable / unknown readings', () => {
        for (const bad of ['unavailable', 'unknown', null]) {
            expect(
                matchesDeviceStateTrigger(
                    { ...base, to: 'on' },
                    'd1',
                    { power: 'on' },
                    { power: bad as any }
                )
            ).toBe(false);
        }
    });

    it('edge: change fires on any transition', () => {
        expect(
            matchesDeviceStateTrigger(
                { ...base, edge: 'change' },
                'd1',
                { power: 'on' },
                { power: 'off' }
            )
        ).toBe(true);
    });

    it('edge: leave fires only when leaving the from value', () => {
        expect(
            matchesDeviceStateTrigger(
                { ...base, edge: 'leave', from: 'on' },
                'd1',
                { power: 'on' },
                { power: 'off' }
            )
        ).toBe(true);
        expect(
            matchesDeviceStateTrigger(
                { ...base, edge: 'leave', from: 'on' },
                'd1',
                { power: 'off' },
                { power: 'pause' }
            )
        ).toBe(false);
    });

    it('compares numbers loosely (JSON "1" vs 1)', () => {
        expect(
            matchesDeviceStateTrigger(
                { deviceId: 'd1', attribute: 'level', to: 1 },
                'd1',
                { level: 0 },
                { level: '1' as any }
            )
        ).toBe(true);
    });

    it('never fires for another device', () => {
        expect(
            matchesDeviceStateTrigger(
                { ...base, to: 'on' },
                'other',
                { power: 'off' },
                { power: 'on' }
            )
        ).toBe(false);
    });

    it('with no target fires on any real change', () => {
        expect(
            matchesDeviceStateTrigger(
                base,
                'd1',
                { power: 'on' },
                { power: 'off' }
            )
        ).toBe(true);
    });
});

describe('evaluateCondition', () => {
    const state = { power: 'on' as const, level: 20 };

    it('handles eq / neq', () => {
        expect(
            evaluateCondition(
                { deviceId: 'd', attribute: 'power', op: 'eq', value: 'on' },
                state
            )
        ).toBe(true);
        expect(
            evaluateCondition(
                { deviceId: 'd', attribute: 'power', op: 'neq', value: 'on' },
                state
            )
        ).toBe(false);
    });

    it('handles gt / lt / between on a number', () => {
        expect(
            evaluateCondition(
                { deviceId: 'd', attribute: 'level', op: 'gt', value: 10 },
                state
            )
        ).toBe(true);
        expect(
            evaluateCondition(
                { deviceId: 'd', attribute: 'level', op: 'lt', value: 10 },
                state
            )
        ).toBe(false);
        expect(
            evaluateCondition(
                {
                    deviceId: 'd',
                    attribute: 'level',
                    op: 'between',
                    value: [15, 25],
                },
                state
            )
        ).toBe(true);
    });

    it('is false when the attribute is absent, true without a condition', () => {
        expect(
            evaluateCondition(
                { deviceId: 'd', attribute: 'x', op: 'eq', value: 1 },
                state
            )
        ).toBe(false);
        expect(evaluateCondition(undefined, state)).toBe(true);
    });
});

describe('edgeApplies', () => {
    it('always / success / failure', () => {
        expect(edgeApplies('always', false)).toBe(true);
        expect(edgeApplies(undefined, false)).toBe(true);
        expect(edgeApplies('success', true)).toBe(true);
        expect(edgeApplies('success', false)).toBe(false);
        expect(edgeApplies('success', null)).toBe(false);
        expect(edgeApplies('failure', false)).toBe(true);
        expect(edgeApplies('failure', true)).toBe(false);
    });
});

describe('indexEdges', () => {
    it('groups edges by source', () => {
        const { out } = indexEdges([
            { from: 't', to: 'a' },
            { from: 't', to: 'b' },
            { from: 'a', to: 'c' },
        ]);
        expect(out.get('t')?.map((e) => e.to)).toEqual(['a', 'b']);
        expect(out.get('a')?.map((e) => e.to)).toEqual(['c']);
        expect(out.get('b')).toBeUndefined();
    });
});

describe('execAutomation', () => {
    const trig = node('t', 'trigger', { trigger: { type: 'MANUAL' } });

    /** A runner recording node ids; results come from `results`. */
    const recorder = (results: Record<string, unknown> = {}) => {
        const calls: string[] = [];
        const run: NodeRunner = async (n) => {
            calls.push(n.id);
            return results[n.id] ?? true;
        };
        return { calls, run };
    };

    it('walks a linear chain in order and skips the trigger itself', async () => {
        const a = automation(
            [
                trig,
                node('a', 'action', { action: { text: 'x' } }),
                node('b', 'action', { action: { text: 'y' } }),
            ],
            [
                { from: 't', to: 'a' },
                { from: 'a', to: 'b' },
            ]
        );
        const { calls, run } = recorder();
        const res = await execAutomation(a, 't', { run });
        expect(calls).toEqual(['a', 'b']);
        expect(res.executed).toEqual(['a', 'b']);
    });

    it('follows fan-out (one trigger, two actions)', async () => {
        const a = automation(
            [
                trig,
                node('a', 'action', { action: { text: 'x' } }),
                node('b', 'notify', { notify: { body: 'n' } }),
            ],
            [
                { from: 't', to: 'a' },
                { from: 't', to: 'b' },
            ]
        );
        const { calls, run } = recorder();
        await execAutomation(a, 't', { run });
        expect(calls.sort()).toEqual(['a', 'b']);
    });

    it("when:'success' skips the branch when the source returned false", async () => {
        const a = automation(
            [
                trig,
                node('a', 'action', { action: { text: 'x' } }),
                node('b', 'action', { action: { text: 'y' } }),
            ],
            [
                { from: 't', to: 'a' },
                { from: 'a', to: 'b', when: 'success' },
            ]
        );
        const { calls, run } = recorder({ a: false });
        const res = await execAutomation(a, 't', { run });
        expect(calls).toEqual(['a']);
        expect(res.skipped).toContain('b');
    });

    it('a false condition prunes its whole subtree', async () => {
        const a = automation(
            [
                trig,
                node('c', 'condition', {
                    condition: {
                        deviceId: 'd',
                        attribute: 'power',
                        op: 'eq',
                        value: 'on',
                    },
                }),
                node('a', 'action', { action: { text: 'x' } }),
            ],
            [
                { from: 't', to: 'c' },
                { from: 'c', to: 'a' },
            ]
        );
        const { calls, run } = recorder({ c: false });
        await execAutomation(a, 't', { run });
        expect(calls).toEqual(['c']); // the action under the false gate never runs
    });

    it('runs a shared node at most once (diamond / loop guard)', async () => {
        const a = automation(
            [
                trig,
                node('a', 'action', { action: { text: 'x' } }),
                node('b', 'action', { action: { text: 'y' } }),
                node('d', 'action', { action: { text: 'z' } }),
            ],
            [
                { from: 't', to: 'a' },
                { from: 't', to: 'b' },
                { from: 'a', to: 'd' },
                { from: 'b', to: 'd' },
            ]
        );
        const { calls, run } = recorder();
        const res = await execAutomation(a, 't', { run });
        expect(calls.filter((id) => id === 'd')).toHaveLength(1);
        expect(res.skipped).toContain('d');
    });

    it('emits action-completed for action and notify nodes', async () => {
        const a = automation(
            [
                trig,
                node('a', 'action', { action: { text: 'allume le salon' } }),
                node('n', 'notify', { notify: { body: 'done' } }),
            ],
            [
                { from: 't', to: 'a' },
                { from: 'a', to: 'n' },
            ]
        );
        const seen: { nodeId: string; text?: string }[] = [];
        const off = onAutomationEvent((e) => {
            if (e.topic === 'action-completed') {
                seen.push({ nodeId: e.nodeId, text: e.text });
            }
        });
        const { run } = recorder();
        await execAutomation(a, 't', { run });
        off();
        expect(seen).toEqual([
            { nodeId: 'a', text: 'allume le salon' },
            { nodeId: 'n', text: 'done' },
        ]);
    });
});


