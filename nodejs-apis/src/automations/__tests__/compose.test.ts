/**
 * NL → automation compose. `req` (the LLM call) and the DB are stubbed, so the
 * suite pins the contract — model/host routing, JSON-schema answer — and the
 * evidence rule that an invented device is dropped, not shipped.
 */
jest.mock('../../ai/llm', () => ({
    req: jest.fn(),
    shoppingModel: () => 'qwen3-1.7b',
    shoppingHost: () => 'llm:9308',
}));
jest.mock('../../core/db', () => ({ cs: {} }));
jest.mock('../../manager/services/activities', () => ({ log: jest.fn() }));
jest.mock('../../shopping/restructure', () => ({
    parseLlmContent: (content: string) => JSON.parse(content),
}));

import { req } from '../../ai/llm';
import {
    buildAutomation,
    composeAutomation,
    deviceAttributes,
    looksLikeNotify,
    normalizeAttribute,
    resolveDevice,
    significantWords,
    AUTOMATION_SCHEMA,
} from '../compose';
import { Device } from '../../types';

const reqMock = req as unknown as jest.Mock;

const DEVICES: Device[] = [
    {
        _id: 'd1',
        name: 'Lumière du salon',
        type: 'light',
        externalId: 'light.salon',
        provider: 'ha',
    },
    {
        _id: 'd2',
        name: 'Lampe cuisine',
        type: 'light',
        externalId: 'light.cuisine',
        provider: 'ha',
    },
];

/** A chat-completion answer carrying a JSON object. */
const answer = (obj: unknown) => ({
    choices: [{ message: { role: 'assistant', content: JSON.stringify(obj) } }],
});

describe('resolveDevice', () => {
    it('matches exactly, ignoring accents and case', () => {
        expect(resolveDevice('lumiere du salon', DEVICES)?._id).toBe('d1');
        expect(resolveDevice('LUMIÈRE DU SALON', DEVICES)?._id).toBe('d1');
    });

    it('matches on a partial name', () => {
        expect(resolveDevice('cuisine', DEVICES)?._id).toBe('d2');
    });

    it('returns nothing for an unknown device (never invented)', () => {
        expect(resolveDevice('garage', DEVICES)).toBeUndefined();
        expect(resolveDevice('', DEVICES)).toBeUndefined();
        expect(resolveDevice(undefined, DEVICES)).toBeUndefined();
    });

    it('prefers the device whose significant words match, not the room', () => {
        const devices: Device[] = [
            {
                _id: 'c1',
                name: 'Salon clim',
                type: 'clim',
                externalId: 'climate.salon',
                provider: 'ha',
            },
            {
                _id: 's1',
                name: 'Volet salon',
                type: 'shutter',
                externalId: 'cover.salon',
                provider: 'ha',
            },
        ];
        // "volet du salon" reduces to {volet, salon} = "Volet salon"; the old
        // substring test would have returned "Salon clim" (first room match).
        expect(resolveDevice('volet du salon', devices)?._id).toBe('s1');
        expect(resolveDevice('Volet salon', devices)?._id).toBe('s1');
    });
});

describe('significantWords', () => {
    it('drops the uninformative particles', () => {
        expect(significantWords('le volet du salon')).toEqual([
            'volet',
            'salon',
        ]);
        expect(significantWords('Lumière du salon')).toEqual([
            'lumiere',
            'salon',
        ]);
        expect(significantWords('de la')).toEqual([]);
    });
});

describe('buildAutomation', () => {
    it('resolves a DEVICE_STATE trigger to a real device id', () => {
        const { automation, warnings } = buildAutomation(
            {
                name: 'Salon',
                triggers: [
                    {
                        type: 'DEVICE_STATE',
                        device: 'Lumière du salon',
                        attribute: 'power',
                        to: 'on',
                    },
                ],
                actions: [{ kind: 'action', text: 'notifie moi' }],
            },
            DEVICES
        );
        expect(warnings).toEqual([]);
        const trigger = automation.nodes.find((n) => n.kind === 'trigger');
        expect(trigger?.trigger?.device).toEqual({
            deviceId: 'd1',
            attribute: 'power',
            to: 'on',
        });
    });

    it('drops an invented device and warns', () => {
        const { automation, warnings } = buildAutomation(
            {
                name: 'X',
                triggers: [
                    { type: 'DEVICE_STATE', device: 'piscine', to: 'on' },
                ],
                actions: [{ kind: 'action', text: 'fais un truc' }],
            },
            DEVICES
        );
        expect(warnings).toHaveLength(1);
        expect(automation.nodes.some((n) => n.kind === 'trigger')).toBe(false);
    });

    it('chains triggers → first action, then actions by success', () => {
        const { automation } = buildAutomation(
            {
                name: 'Chain',
                triggers: [
                    { type: 'CRON', cron: '30 07 * * *' },
                    { type: 'MANUAL' },
                ],
                actions: [
                    { kind: 'action', text: 'ouvre les volets' },
                    { kind: 'notify', text: 'bonjour' },
                ],
            },
            DEVICES
        );
        const triggers = automation.nodes.filter((n) => n.kind === 'trigger');
        expect(triggers).toHaveLength(2);
        expect(triggers[0].trigger?.cron?.expression).toBe('30 07 * * *');
        // both triggers feed the first action
        expect(automation.edges.filter((e) => e.to === 'a1')).toHaveLength(2);
        // actions chained on success
        expect(automation.edges).toContainEqual({
            from: 'a1',
            to: 'n2',
            when: 'success',
        });
        expect(automation.nodes.find((n) => n.id === 'n2')?.notify?.body).toBe(
            'bonjour'
        );
    });

    it('falls back to a default cron when the model omits it', () => {
        const { automation } = buildAutomation(
            { name: 'D', triggers: [{ type: 'CRON' }], actions: [] },
            DEVICES
        );
        const trigger = automation.nodes.find((n) => n.kind === 'trigger');
        expect(trigger?.trigger?.cron?.expression).toBe('00 09 * * *');
    });

    it('maps a day_night trigger (sunrise/sunset via the météo device)', () => {
        const { automation } = buildAutomation(
            {
                name: 'Lever du soleil',
                triggers: [
                    { type: 'DEVICE_STATE', device: 'Météo', attribute: 'day_night', to: 'Jour' },
                ],
                actions: [{ kind: 'notify', text: 'Le jour se lève' }],
            },
            [
                {
                    _id: 'w1',
                    name: 'Météo',
                    type: 'sensor',
                    externalId: 'weather.home',
                    provider: 'weather',
                    state: {
                        power: 'on',
                        properties: { day_night: 'Jour' },
                    },
                } as any,
            ]
        );
        const trigger = automation.nodes.find((n) => n.kind === 'trigger');
        expect(trigger?.trigger?.device).toEqual({
            deviceId: 'w1',
            attribute: 'day_night',
            to: 'Jour',
        });
    });

    it('inserts a condition gate between the trigger and the action', () => {
        const { automation } = buildAutomation(
            {
                name: 'Gate',
                triggers: [{ type: 'MANUAL' }],
                conditions: [
                    {
                        device: 'Lumière du salon',
                        attribute: 'power',
                        op: 'eq',
                        value: 'off',
                    },
                ],
                actions: [{ kind: 'action', text: 'allume le salon' }],
            },
            DEVICES
        );
        const cond = automation.nodes.find((n) => n.kind === 'condition');
        expect(cond?.condition).toEqual({
            deviceId: 'd1',
            attribute: 'power',
            op: 'eq',
            value: 'off',
        });
        // trigger → condition → action
        expect(automation.edges).toContainEqual({ from: 't1', to: 'c1' });
        expect(automation.edges).toContainEqual({
            from: 'c1',
            to: 'a1',
            when: 'success',
        });
    });

    it('parses a between condition range', () => {
        const { automation } = buildAutomation(
            {
                name: 'Range',
                triggers: [{ type: 'MANUAL' }],
                conditions: [
                    {
                        device: 'Lumière du salon',
                        attribute: 'level',
                        op: 'between',
                        value: '15-25',
                    },
                ],
                actions: [],
            },
            DEVICES
        );
        const cond = automation.nodes.find((n) => n.kind === 'condition');
        expect(cond?.condition?.value).toEqual([15, 25]);
    });
});

describe('composeAutomation', () => {
    beforeEach(() => {
        reqMock.mockReset();
    });

    it('asks the small model with the schema and lists the devices', async () => {
        reqMock.mockResolvedValueOnce(
            answer({
                name: 'Salon allumé',
                triggers: [
                    {
                        type: 'DEVICE_STATE',
                        device: 'Lumière du salon',
                        attribute: 'power',
                        to: 'on',
                    },
                ],
                actions: [{ kind: 'notify', text: 'Le salon est allumé' }],
            })
        );

        const { automation, warnings } = await composeAutomation(
            "quand la lumière du salon s'allume, préviens-moi",
            DEVICES
        );

        expect(warnings).toEqual([]);
        expect(automation.name).toBe('Salon allumé');

        const [body, host] = reqMock.mock.calls[0];
        expect(body.model).toBe('qwen3-1.7b');
        expect(body.temperature).toBe(0);
        expect(body.response_format.type).toBe('json_schema');
        expect(body.response_format.json_schema.schema).toBe(AUTOMATION_SCHEMA);
        expect(
            body.response_format.json_schema.schema.properties.triggers.items
                .properties.attribute.enum
        ).toEqual(['power', 'level', 'day_night']);
        // the catalogue is handed to the model (it can only pick a real name)
        expect(body.messages[1].content).toContain('Lumière du salon');
        // ...and each device advertises the attributes it can actually express
        expect(body.messages[1].content).toContain('états:');
        expect(host).toBe('llm:9308');
    });

    it('throws on an empty answer', async () => {
        reqMock.mockResolvedValueOnce({ choices: [{ message: {} }] });
        await expect(
            composeAutomation('fais un truc', DEVICES)
        ).rejects.toThrow(/empty answer/);
    });

    it('throws when the answer is not a valid draft', async () => {
        reqMock.mockResolvedValueOnce({
            choices: [
                { message: { role: 'assistant', content: 'not json at all' } },
            ],
        });
        await expect(
            composeAutomation('fais un truc', DEVICES)
        ).rejects.toThrow(/did not return an automation/);
    });
});

describe('device attributes (evidence rule)', () => {
    const LIGHT: Device = {
        _id: 'd1',
        name: 'Lumière du salon',
        type: 'light',
        externalId: 'light.salon',
        provider: 'ha',
    };
    const METEO: Device = {
        _id: 'w1',
        name: 'Météo',
        type: 'sensor',
        externalId: 'weather.home',
        provider: 'weather',
        state: { power: 'on', properties: { day_night: 'Jour' } } as any,
    };

    it('lists power/level plus the last-known properties', () => {
        expect([...deviceAttributes(LIGHT)].sort()).toEqual(['level', 'power']);
        expect(deviceAttributes(METEO).has('day_night')).toBe(true);
    });

    it('keeps an attribute the device exposes', () => {
        expect(normalizeAttribute(METEO, 'day_night', 'Jour')).toEqual({
            attribute: 'day_night',
            value: 'Jour',
        });
    });

    it('remaps day_night to power when the device does not expose it', () => {
        const day = normalizeAttribute(LIGHT, 'day_night', 'Jour');
        expect(day.attribute).toBe('power');
        expect(day.value).toBe('on');
        expect(day.warning).toBeTruthy();
        expect(normalizeAttribute(LIGHT, 'day_night', 'Nuit').value).toBe('off');
    });

    it('falls back to power for any other unsupported attribute', () => {
        const other = normalizeAttribute(LIGHT, 'color', 'red');
        expect(other.attribute).toBe('power');
        expect(other.warning).toBeTruthy();
    });

    it('fixes the reported bug end-to-end (day_night on a light → power/on)', () => {
        const { automation, warnings } = buildAutomation(
            {
                name: 'Salon',
                triggers: [
                    {
                        type: 'DEVICE_STATE',
                        device: 'Lumière du salon',
                        attribute: 'day_night',
                        to: 'Jour',
                    },
                ],
                actions: [{ kind: 'action', text: 'préviens-moi' }],
            },
            [LIGHT]
        );
        const trigger = automation.nodes.find((n) => n.kind === 'trigger');
        expect(trigger?.trigger?.device).toEqual({
            deviceId: 'd1',
            attribute: 'power',
            to: 'on',
        });
        expect(warnings.length).toBeGreaterThan(0);
        // a plain action that asks to be told is reclassified into a notify
        expect(
            automation.nodes.find((n) => n.kind === 'notify')?.notify?.body
        ).toBe('préviens-moi');
    });

    it('warns when the device name only approximately matches', () => {
        const devices: Device[] = [
            {
                _id: 'c1',
                name: 'Salon clim',
                type: 'clim',
                externalId: 'climate.salon',
                provider: 'ha',
            },
            {
                _id: 's1',
                name: 'Volet salon',
                type: 'shutter',
                externalId: 'cover.salon',
                provider: 'ha',
            },
        ];
        const { warnings } = buildAutomation(
            {
                name: 'X',
                triggers: [
                    {
                        type: 'DEVICE_STATE',
                        device: 'salon',
                        attribute: 'power',
                        to: 'on',
                    },
                ],
                actions: [{ kind: 'action', text: 'x' }],
            },
            devices
        );
        expect(
            warnings.some((w) => w.startsWith('Approximate device'))
        ).toBe(true);
    });
});

describe('looksLikeNotify', () => {
    it('detects a request to be informed, not a home command', () => {
        expect(looksLikeNotify('préviens-moi')).toBe(true);
        expect(looksLikeNotify('avertis-moi quand ça arrive')).toBe(true);
        expect(looksLikeNotify('allume la cuisine')).toBe(false);
        expect(looksLikeNotify('ouvre les volets')).toBe(false);
    });
});

