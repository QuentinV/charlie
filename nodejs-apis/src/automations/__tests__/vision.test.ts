/**
 * VISION trigger matching — pure. The bus and the walker are covered by
 * engine.test.ts; here we only prove a `vision` event routes to a VISION trigger
 * with the camera/mode/kind/class filters.
 */
jest.mock('../../ai/flow', () => ({ ask: jest.fn() }));
jest.mock('../../core/notifications', () => ({
    sendPushNotifcation: jest.fn(),
}));
jest.mock('../../manager/services/activities', () => ({ log: jest.fn() }));
jest.mock('../../core/db', () => ({
    cs: {
        devices: { findOne: jest.fn() },
        automations: { find: jest.fn() },
    },
}));
jest.mock('node-cron', () => ({ schedule: jest.fn() }));

import { matchesVisionTrigger, triggerMatches } from '../index';
import { Automation, AutomationTrigger, VisionEvent } from '../../types';

const event = (over: Partial<VisionEvent> = {}): VisionEvent => ({
    at: 0,
    cameraId: 'cam1',
    modes: ['presence'],
    kind: 'enter',
    classes: ['person'],
    ...over,
});

describe('matchesVisionTrigger', () => {
    it('matches everything with an empty trigger', () => {
        expect(matchesVisionTrigger({}, event())).toBe(true);
    });

    it('filters by camera, mode, kind and class (case-insensitive)', () => {
        expect(matchesVisionTrigger({ cameraId: 'cam2' }, event())).toBe(false);
        expect(
            matchesVisionTrigger(
                { modes: ['grocery'] },
                event({ modes: ['presence'] })
            )
        ).toBe(false);
        expect(matchesVisionTrigger({ kind: 'leave' }, event())).toBe(false);
        expect(matchesVisionTrigger({ classes: ['dog'] }, event())).toBe(false);
        expect(matchesVisionTrigger({ classes: ['PERSON'] }, event())).toBe(true);
    });

    it('matches a mode any-of, and no mode means no filter', () => {
        expect(matchesVisionTrigger({ modes: ['PRESENCE'] }, event())).toBe(true);
        expect(
            matchesVisionTrigger({ modes: ['pet', 'presence'] }, event())
        ).toBe(true);
        expect(matchesVisionTrigger({ modes: [] }, event())).toBe(true);
        expect(
            matchesVisionTrigger(
                { modes: ['presence'] },
                event({ modes: ['grocery', 'pet'] })
            )
        ).toBe(false);
    });

    it('is false without a trigger', () => {
        expect(matchesVisionTrigger(undefined, event())).toBe(false);
    });
});

describe('triggerMatches (VISION)', () => {
    const automation: Automation = {
        _id: 'a1',
        name: 't',
        active: true,
        nodes: [],
        edges: [],
    };
    const trigger: AutomationTrigger = {
        type: 'VISION',
        vision: { kind: 'enter' },
    };

    it('routes a vision event to the VISION trigger', () => {
        expect(
            triggerMatches(automation, trigger, {
                topic: 'vision',
                at: 0,
                event: event(),
            })
        ).toBe(true);
        expect(
            triggerMatches(automation, trigger, {
                topic: 'vision',
                at: 0,
                event: event({ kind: 'leave' }),
            })
        ).toBe(false);
    });

    it('never matches a vision trigger on a device-state event', () => {
        expect(
            triggerMatches(automation, trigger, {
                topic: 'device-state',
                at: 0,
                deviceId: 'd1',
            })
        ).toBe(false);
    });
});
