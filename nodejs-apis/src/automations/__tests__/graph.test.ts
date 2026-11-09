/**
 * House graph + observed effects.
 *
 * `buildHouseGraph` is pure, so it is driven with plain fixtures; the effect
 * recorder gets an in-memory `automation_effects` so the idempotent, counted
 * upsert is asserted for real. Nothing here boots the engine, the LLM or Mongo.
 */
jest.mock('../../core/db', () => {
    const effects: any[] = [];
    const matches = (doc: any, query: any = {}) =>
        Object.entries(query).every(([key, value]) => doc[key] === value);

    return {
        __effects: effects,
        cs: {
            automationEffects: {
                updateOne: async (query: any, patch: any, options: any) => {
                    let doc = effects.find((d) => matches(d, query));
                    if (!doc) {
                        if (!options?.upsert) return { modifiedCount: 0 };
                        doc = { ...query, ...(patch?.$setOnInsert ?? {}) };
                        effects.push(doc);
                    } else {
                        Object.assign(doc, patch?.$set ?? {});
                    }
                    for (const [key, value] of Object.entries(
                        patch?.$inc ?? {}
                    )) {
                        doc[key] = (doc[key] ?? 0) + (value as number);
                    }
                    return { modifiedCount: 1 };
                },
                find: () => ({ toArray: async () => effects }),
            },
        },
    };
});

import {
    buildHouseGraph,
    stateKey,
    triggerEdgeLabel,
    triggerFlowValue,
    triggerStateValue,
} from '../graph';
import {
    attributedAction,
    changedAttributes,
    noteActionSettled,
    noteActionStarted,
    recordObservedEffect,
    resetEffectWindows,
    runWithAction,
    ACTION_SETTLE_MS,
} from '../effects';
import { Automation, AutomationEffect, AutomationNode, Device } from '../../types';

const node = (
    id: string,
    kind: AutomationNode['kind'],
    extra: Partial<AutomationNode> = {}
): AutomationNode => ({ id, kind, ...extra });

const automation = (over: Partial<Automation> = {}): Automation => ({
    _id: 'a1',
    name: 'A1',
    active: true,
    nodes: [],
    edges: [],
    ...over,
});

const DEVICES = [
    {
        _id: 'd1',
        name: 'Volet salon',
        type: 'shutter',
        externalId: 'cover.salon',
        provider: 'ha',
    },
    {
        _id: 'd2',
        name: 'Lumière cuisine',
        type: 'light',
        externalId: 'light.cuisine',
        provider: 'ha',
    },
] as Device[];

const effect = (over: Partial<AutomationEffect> = {}): AutomationEffect => ({
    _id: 'a1:act|d2|power|on',
    automationId: 'a1',
    nodeId: 'act',
    deviceId: 'd2',
    attribute: 'power',
    value: 'on',
    count: 3,
    firstAt: 1000,
    lastAt: 2000,
    ...over,
});

describe('triggerStateValue', () => {
    it('maps enter/leave/change onto a definition value', () => {
        expect(triggerStateValue({ deviceId: 'd1', attribute: 'power', to: 'on' })).toBe('on');
        expect(
            triggerStateValue({
                deviceId: 'd1',
                attribute: 'power',
                edge: 'leave',
                from: 'on',
            })
        ).toBe('on');
        expect(
            triggerStateValue({
                deviceId: 'd1',
                attribute: 'level',
                edge: 'change',
            })
        ).toBe('*');
    });

    it('keys a definition on device·attribute, never on the value', () => {
        expect(stateKey('d1', 'power')).toBe('d1|power');
    });
});

describe('trigger labels', () => {
    it('reads enter / leave / change as an arc label', () => {
        expect(
            triggerEdgeLabel({ deviceId: 'd1', attribute: 'power', to: 'on' })
        ).toBe('on');
        expect(
            triggerEdgeLabel({
                deviceId: 'd1',
                attribute: 'power',
                edge: 'leave',
                from: 'on',
            })
        ).toBe('≠ on');
        expect(
            triggerEdgeLabel({
                deviceId: 'd1',
                attribute: 'level',
                edge: 'change',
            })
        ).toBe('~');
    });

    it('lists only the concrete transitions on the definition', () => {
        expect(
            triggerFlowValue({ deviceId: 'd1', attribute: 'power', to: 'on' })
        ).toBe('on');
        expect(
            triggerFlowValue({
                deviceId: 'd1',
                attribute: 'power',
                edge: 'change',
            })
        ).toBe('~');
        expect(
            triggerFlowValue({
                deviceId: 'd1',
                attribute: 'power',
                edge: 'leave',
                from: 'on',
            })
        ).toBeUndefined();
    });
});

describe('changedAttributes', () => {
    it('reports only the attributes that really moved', () => {
        expect(
            changedAttributes(
                { power: 'off', level: 0 },
                { power: 'on', level: 80 }
            )
        ).toEqual({ power: 'on', level: 80 });
    });

    it('ignores a re-read of the same value', () => {
        expect(changedAttributes({ power: 'on' }, { power: 'on' })).toEqual({});
    });

    it('never records an unavailable reading', () => {
        expect(
            changedAttributes(
                { power: 'on' },
                { power: 'unavailable' as unknown as 'on' }
            )
        ).toEqual({});
        expect(changedAttributes(undefined, undefined)).toEqual({});
    });

    it('picks up free properties (a sensor reading)', () => {
        expect(
            changedAttributes(
                { properties: { temperature: 19 } },
                { properties: { temperature: 21, humidity: 55 } }
            )
        ).toEqual({ temperature: 21, humidity: 55 });
    });
});

describe('action correlation window', () => {
    beforeEach(() => resetEffectWindows());

    it('credits an action for a while after it settled', () => {
        const t0 = 1_000_000;
        noteActionStarted('a1', 'act', t0);
        expect(attributedAction(t0 + 500)).toEqual({
            automationId: 'a1',
            nodeId: 'act',
        });
        // A gateway writes back seconds later: still inside the window.
        expect(attributedAction(t0 + ACTION_SETTLE_MS - 1)).toEqual({
            automationId: 'a1',
            nodeId: 'act',
        });
        expect(attributedAction(t0 + ACTION_SETTLE_MS + 1)).toBeUndefined();
    });

    it('extends the window when the action settles', () => {
        const t0 = 1_000_000;
        noteActionStarted('a1', 'act', t0);
        noteActionSettled('a1', 'act', t0 + 6000);
        expect(attributedAction(t0 + 6000 + ACTION_SETTLE_MS - 1)).toEqual({
            automationId: 'a1',
            nodeId: 'act',
        });
    });

    it('never attributes a transition that predates the action', () => {
        noteActionStarted('a1', 'act', 1_000_000);
        expect(attributedAction(999_999)).toBeUndefined();
    });

    it('prefers the most recently started window when two overlap', () => {
        noteActionStarted('a1', 'first', 1000);
        noteActionStarted('a1', 'second', 1500);
        expect(attributedAction(1600)).toEqual({
            automationId: 'a1',
            nodeId: 'second',
        });
    });

    it('credits the exact action of the running async context', async () => {
        // The context must survive the awaits inside an action, which is how a
        // write announced by `changeDeviceState` is attributed today.
        const seen = await runWithAction('a9', 'act9', async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return attributedAction(Date.now());
        });
        expect(seen).toEqual({ automationId: 'a9', nodeId: 'act9' });
    });

    it('exposes no action once the context is left', async () => {
        await runWithAction('a9', 'act9', async () => undefined);
        expect(attributedAction(Date.now())).toBeUndefined();
    });
});

describe('recordObservedEffect', () => {
    it('counts re-observations of one arc instead of duplicating it', async () => {
        const input = {
            automationId: 'a1',
            nodeId: 'act',
            deviceId: 'd2',
            attribute: 'power',
            value: 'on' as const,
        };
        await recordObservedEffect(input);
        await recordObservedEffect(input);

        const { cs } = jest.requireMock('../../core/db');
        const rows = await cs.automationEffects.find().toArray();
        const mine = rows.filter((row: any) => row.nodeId === 'act');
        expect(mine).toHaveLength(1);
        expect(mine[0].count).toBe(2);
        expect(mine[0].firstAt).toBeLessThanOrEqual(mine[0].lastAt);
    });
});

describe('buildHouseGraph', () => {
    const stateTrigger = () =>
        node('t1', 'trigger', {
            trigger: {
                type: 'DEVICE_STATE',
                device: { deviceId: 'd1', attribute: 'power', to: 'on' },
            },
        });

    it('shares one state node between every automation watching it', () => {
        const graph = buildHouseGraph(
            [
                automation({
                    _id: 'a1',
                    nodes: [
                        stateTrigger(),
                        node('n1', 'notify', { notify: { body: 'un' } }),
                    ],
                    edges: [{ from: 't1', to: 'n1' }],
                }),
                automation({
                    _id: 'a2',
                    nodes: [
                        stateTrigger(),
                        node('n1', 'notify', { notify: { body: 'deux' } }),
                    ],
                    edges: [{ from: 't1', to: 'n1' }],
                }),
            ],
            [],
            DEVICES
        );

        const states = graph.nodes.filter((n) => n.kind === 'state');
        expect(states).toHaveLength(1);
        expect(states[0].watches).toBe(2);
        expect(states[0].label).toBe('Volet salon · power');
        expect(states[0].values).toEqual(['on']);
        expect(states[0].deviceId).toBe('d1');
        expect(graph.nodes.filter((n) => n.kind === 'notify')).toHaveLength(2);
        expect(graph.edges.filter((e) => e.kind === 'flow')).toHaveLength(2);
        // Both flows start at the single shared state node.
        expect(new Set(graph.edges.map((e) => e.from)).size).toBe(1);
        expect(graph.stats).toMatchObject({ automations: 2, states: 1 });
    });

    it('merges `on` and `off` into one definition, value on the arc', () => {
        const graph = buildHouseGraph(
            [
                automation({
                    _id: 'a1',
                    nodes: [
                        node('t1', 'trigger', {
                            trigger: {
                                type: 'DEVICE_STATE',
                                device: {
                                    deviceId: 'd1',
                                    attribute: 'power',
                                    to: 'on',
                                },
                            },
                        }),
                        node('n1', 'notify', {
                            notify: { body: 'allumée' },
                        }),
                    ],
                    edges: [{ from: 't1', to: 'n1' }],
                }),
                automation({
                    _id: 'a2',
                    nodes: [
                        node('t1', 'trigger', {
                            trigger: {
                                type: 'DEVICE_STATE',
                                device: {
                                    deviceId: 'd1',
                                    attribute: 'power',
                                    to: 'off',
                                },
                            },
                        }),
                        node('act', 'action', {
                            action: { text: 'allume la cuisine' },
                        }),
                    ],
                    edges: [{ from: 't1', to: 'act' }],
                }),
            ],
            [],
            DEVICES
        );

        const states = graph.nodes.filter((n) => n.kind === 'state');
        expect(states).toHaveLength(1);
        expect(states[0].label).toBe('Volet salon · power');
        expect(states[0].watches).toBe(2);
        expect(states[0].values).toEqual(['off', 'on']);
        // The transition rides on the arc, so nothing is lost.
        const labels = graph.edges
            .filter((e) => e.kind === 'flow')
            .map((e) => e.label)
            .sort();
        expect(labels).toEqual(['off', 'on']);
    });

    it('draws an observed effect onto the state it produced', () => {
        const graph = buildHouseGraph(
            [
                automation({
                    nodes: [
                        stateTrigger(),
                        node('act', 'action', {
                            action: { text: 'allume la cuisine' },
                        }),
                    ],
                    edges: [{ from: 't1', to: 'act' }],
                }),
            ],
            [effect()],
            DEVICES
        );

        const arcs = graph.edges.filter((e) => e.kind === 'effect');
        expect(arcs).toHaveLength(1);
        expect(arcs[0].count).toBe(3);
        expect(arcs[0].lastAt).toBe(2000);
        expect(graph.nodes.find((n) => n.id === arcs[0].to)?.label).toBe(
            'Lumière cuisine · power'
        );
        expect(arcs[0].label).toBe('on');
        expect(graph.stats.effects).toBe(1);
    });

    it('lands an effect on the definition it belongs to, whatever the value', () => {
        const graph = buildHouseGraph(
            [
                automation({
                    nodes: [
                        node('t1', 'trigger', {
                            trigger: {
                                type: 'DEVICE_STATE',
                                device: {
                                    deviceId: 'd1',
                                    attribute: 'power',
                                    to: 'off',
                                },
                            },
                        }),
                        node('act', 'action', {
                            action: { text: 'allume la cuisine' },
                        }),
                    ],
                    edges: [{ from: 't1', to: 'act' }],
                }),
            ],
            // the action produced the *other* value of the same definition
            [effect({ deviceId: 'd1', value: 'on', _id: 'a1:act|d1|power|on' })],
            DEVICES
        );

        const states = graph.nodes.filter((n) => n.kind === 'state');
        expect(states).toHaveLength(1); // one definition, never a parallel node
        expect(states[0].values).toEqual(['off', 'on']);
        expect(states[0].watches).toBe(1);
        expect(states[0].effects).toBe(1);
        const arc = graph.edges.find((e) => e.kind === 'effect');
        expect(arc?.to).toBe(states[0].id); // it points at the node that exists
        expect(arc?.label).toBe('on');
    });

    it('keeps an effect on a state nothing watches (a hole in the automations)', () => {
        const graph = buildHouseGraph(
            [
                automation({
                    nodes: [
                        node('t1', 'trigger', {
                            trigger: {
                                type: 'CRON',
                                cron: { expression: '00 9 * * *' },
                            },
                        }),
                        node('act', 'action', { action: { text: 'ouvre' } }),
                    ],
                    edges: [{ from: 't1', to: 'act' }],
                }),
            ],
            [effect()],
            DEVICES
        );

        const state = graph.nodes.find((n) => n.kind === 'state');
        expect(state?.watches).toBeUndefined();
        expect(state?.effects).toBe(1);
        // the CRON trigger became a schedule node, never a state
        expect(graph.nodes.some((n) => n.kind === 'schedule')).toBe(true);
    });

    it('ignores a stale effect whose action no longer exists', () => {
        const graph = buildHouseGraph(
            [automation()],
            [effect({ nodeId: 'gone' })],
            DEVICES
        );
        expect(graph.edges).toHaveLength(0);
        expect(graph.nodes).toHaveLength(0);
    });

    it('links an EVENT trigger to the action it listens to', () => {
        const graph = buildHouseGraph(
            [
                automation({
                    _id: 'a1',
                    nodes: [node('act', 'action', { action: { text: 'ouvre' } })],
                }),
                automation({
                    _id: 'a2',
                    nodes: [
                        node('t1', 'trigger', {
                            trigger: { type: 'EVENT', event: 'action:a1:act' },
                        }),
                        node('n1', 'notify', { notify: { body: 'ok' } }),
                    ],
                    edges: [{ from: 't1', to: 'n1' }],
                }),
            ],
            [],
            DEVICES
        );

        const listens = graph.edges.filter((e) => e.kind === 'listens');
        expect(listens).toHaveLength(1);
        expect(listens[0].to).toBe('nd:a1:act');
        expect(graph.nodes.find((n) => n.id === 'nd:a1:act')?.label).toBe(
            'ouvre'
        );
    });

    it('flags the cycle an action closes on its own trigger', () => {
        const graph = buildHouseGraph(
            [
                automation({
                    nodes: [
                        stateTrigger(),
                        node('act', 'action', { action: { text: 'allume' } }),
                    ],
                    edges: [{ from: 't1', to: 'act' }],
                }),
            ],
            // the action produced the very state that wakes it
            [effect({ _id: 'a1:act|d1|power|on', deviceId: 'd1', value: 'on' })],
            DEVICES
        );

        expect(graph.stats.cycles).toBe(2);
        expect(graph.edges.every((e) => e.cycle)).toBe(true);
    });

    it('labels gates and schedules, and ignores dangling edges', () => {
        const graph = buildHouseGraph(
            [
                automation({
                    nodes: [
                        node('t1', 'trigger', {
                            trigger: {
                                type: 'CRON',
                                cron: { expression: '30 7 * * *' },
                            },
                        }),
                        node('c1', 'condition', {
                            condition: {
                                deviceId: 'd2',
                                attribute: 'level',
                                op: 'gt',
                                value: 40,
                            },
                        }),
                        node('act', 'action', { action: { text: 'allume' } }),
                    ],
                    edges: [
                        { from: 't1', to: 'c1' },
                        { from: 'c1', to: 'act' },
                        { from: 'act', to: 'nowhere' },
                    ],
                }),
            ],
            [],
            DEVICES
        );

        expect(graph.nodes.find((n) => n.kind === 'schedule')?.label).toBe(
            '⏰ 30 7 * * *'
        );
        expect(graph.nodes.find((n) => n.kind === 'condition')?.label).toBe(
            'Lumière cuisine · level gt 40'
        );
        expect(graph.edges).toHaveLength(2); // the dangling edge is dropped
    });
});



