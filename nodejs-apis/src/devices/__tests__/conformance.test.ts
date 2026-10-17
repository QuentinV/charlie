import fs from 'fs';
import path from 'path';
import { haCallService } from '../providers/homeassistant/client';
import {
    haApplyPropertyWrites,
    haCallTarget,
    haDomainToControlProfile,
    haDomainToDeviceType,
    haEntityCapabilities,
    haPowerTarget,
    haPropertyToService,
    haStateToDeviceState,
} from '../providers/homeassistant/provider';

// Only the write path needs the HA transport: stub it so fixtures can assert
// service calls without a running Home Assistant.
jest.mock('../providers/homeassistant/client', () => ({
    ensureHaSession: jest.fn(async () => true),
    haCallService: jest.fn(async () => undefined),
    haGetEntities: jest.fn(async () => []),
    haGetEntityRegistry: jest.fn(async () => []),
    haGetRegistryEntry: jest.fn(async () => undefined),
    haGetState: jest.fn(async () => null),
    haGetStates: jest.fn(async () => []),
    haGetServices: jest.fn(async () => ({})),
    isHaConfigured: jest.fn(() => true),
}));

const callService = haCallService as unknown as jest.Mock;

/**
 * A conformance fixture describes ONE real (or realistic) device payload: the
 * entity state, its entity-registry entry and the relevant slice of the HA
 * services catalogue, plus what the pipeline must produce from it.
 *
 * Fixtures are the gate for every capability change: a new device type or
 * domain lands as a fixture FIRST, then the code that satisfies it.
 */
interface ConformanceFixture {
    description: string;
    provider: string;
    entity: any;
    registry?: any;
    /**
     * Other entities of the SAME HA device (a TV is a `media_player` next to the
     * `remote` that powers it) — i.e. what `siblingDomainsFor` asks for.
     */
    siblings?: any[];
    services?: any;
    expect: {
        type: string;
        control?: string;
        power: string;
        stateKeys: string[];
        /**
         * The canonical numeric value (`DeviceState.level`) the payload must
         * produce: brightness, position, volume, percentage, humidity, ambient
         * temperature (°C) or a sensor reading.
         */
        level?: number;
        state?: Record<string, any>;
        options?: Record<string, string[]>;
        readonly?: string[];
        writes?: Record<
            string,
            {
                value: string | number | boolean;
                domain: string;
                service: string;
                data: Record<string, any>;
            }
        >;
        /** Keys that must NEVER be translated from the properties bag. */
        notViaProperties?: string[];
        functions?: string[];
        /** `function name → expected inputSchema` (partial match). */
        inputSchema?: Record<string, any[]>;
        /**
         * `function name → fields HA leaves free` (no selector list, no
         * attribute): they must carry no options. Charlie ships no vocabulary of
         * its own — a gateway's key names are the gateway's business.
         */
        freeFields?: Record<string, string[]>;
        /** `function name → the entity the call must be sent to`. */
        functionEntity?: Record<string, string>;
        /** Entity a power change must be sent to (default: the device itself). */
        powerTarget?: string;
        /** Canonical property values the fixture entity must produce. */
        stateValues?: Record<string, any>;
        /**
         * Schema keys allowed to have no readable value — a documented gap of
         * the integration. Everything else a schema advertises must resolve.
         */
        optionalValues?: string[];
    };
}

const fixturesDir = path.join(__dirname, 'fixtures');

const fixtureFiles = fs
    .readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

const loadFixture = (file: string): ConformanceFixture =>
    JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));

describe('capability conformance (real payloads drive the pipeline)', () => {
    test('every fixture is self-describing and covers a known provider', () => {
        expect(fixtureFiles.length).toBeGreaterThanOrEqual(2);
        for (const file of fixtureFiles) {
            const fx = loadFixture(file);
            expect(`${file}: ${fx.provider}`).toBe(`${file}: homeassistant`);
            expect(fx.description).toBeTruthy();
            expect(fx.entity?.entity_id).toContain('.');
            expect(fx.expect?.type).toBeTruthy();
            expect(Array.isArray(fx.expect?.stateKeys)).toBe(true);
        }
    });

    describe.each(fixtureFiles)('%s', (file) => {
        const fx = loadFixture(file);
        const domain = fx.entity.entity_id.split('.')[0];
        const capabilities = haEntityCapabilities(
            fx.entity,
            fx.registry,
            fx.services,
            fx.siblings ?? []
        );
        const state = haStateToDeviceState(fx.entity);
        const stateRecord = state as unknown as Record<string, any>;

        // A schema key is "readable" when the fixture entity actually produces
        // it: from the properties bag (gateway attributes + the semantics the
        // provider derives from the entity state) or from the DeviceState
        // itself (`level`).
        const readable = (key: string) =>
            state.properties?.[key] !== undefined ||
            stateRecord[key] !== undefined;

        test('domain → device type + control profile', () => {
            expect(haDomainToDeviceType(domain)).toBe(fx.expect.type);
            expect(haDomainToControlProfile(domain)).toBe(fx.expect.control);
        });

        test('state schema (keys, ranges, enum options, readonly)', () => {
            expect(capabilities.state?.map((f) => f.key)).toEqual(
                fx.expect.stateKeys
            );

            for (const [key, expected] of Object.entries(
                fx.expect.state ?? {}
            )) {
                const field = capabilities.state?.find((f) => f.key === key);
                expect(field).toMatchObject(expected);
            }

            for (const [key, options] of Object.entries(
                fx.expect.options ?? {}
            )) {
                const field = capabilities.state?.find((f) => f.key === key);
                expect(field?.options?.map((o) => o.value)).toEqual(options);
            }

            for (const key of fx.expect.readonly ?? []) {
                const field = capabilities.state?.find((f) => f.key === key);
                expect(field?.readonly).toBe(true);
            }
        });

        test('every advertised property has a readable value', () => {
            // A schema is a promise to the panel and to the agent: whatever it
            // advertises must be readable from a real payload. The mode of a
            // climate is exactly why this exists — HA keeps it in the entity
            // state, so it never shows up as an attribute.
            const optional = new Set(fx.expect.optionalValues ?? []);
            const unreadable = (capabilities.state ?? [])
                .map((field) => field.key)
                .filter((key) => !optional.has(key) && !readable(key));

            expect(unreadable).toEqual([]);
        });

        test('the fixture entity produces the expected property values', () => {
            for (const [key, expected] of Object.entries(
                fx.expect.stateValues ?? {}
            )) {
                const value =
                    state.properties?.[key] ?? stateRecord[key];
                expect(`${key}=${value}`).toBe(`${key}=${expected}`);
            }
        });

        test('functions match the services catalogue', () => {
            expect((capabilities.functions ?? []).map((f) => f.name)).toEqual(
                fx.expect.functions ?? []
            );
        });

        test('function input schemas expose UI controls + option lists', () => {
            for (const [name, expected] of Object.entries(
                fx.expect.inputSchema ?? {}
            )) {
                const fn = (capabilities.functions ?? []).find(
                    (f) => f.name === name
                );
                expect(fn?.inputSchema).toMatchObject(expected);
            }
        });

        test('free fields carry no option list', () => {
            for (const [name, keys] of Object.entries(
                fx.expect.freeFields ?? {}
            )) {
                const fn = (capabilities.functions ?? []).find(
                    (f) => f.name === name
                );
                for (const key of keys) {
                    const field = fn?.inputSchema?.find(
                        (candidate) => candidate.key === key
                    );
                    expect(field).toBeDefined();
                    expect(field?.options).toBeUndefined();
                }
            }
        });

        test('sibling functions are routed back to the entity that owns them', () => {
            for (const [name, entityId] of Object.entries(
                fx.expect.functionEntity ?? {}
            )) {
                expect(
                    haCallTarget(name, fx.entity.entity_id, fx.siblings ?? [])
                ).toBe(entityId);
            }
        });

        test('power goes to the entity that can do it', () => {
            expect(
                haPowerTarget(
                    fx.entity.entity_id,
                    domain,
                    fx.registry?.supported_features,
                    fx.siblings ?? [],
                    fx.services
                )
            ).toBe(fx.expect.powerTarget ?? fx.entity.entity_id);
        });

        test('power is derived from the entity state', () => {
            expect(state.power).toBe(fx.expect.power);
        });

        test("level is the domain's canonical numeric value", () => {
            // Every domain that HAS a main number publishes it as `level`
            // (brightness, position, volume, percentage, humidity, ambient
            // temperature, sensor reading), read from the same captured payload
            // the cards, the chart and the agent consume.
            if (fx.expect.level !== undefined) {
                expect(state.level).toBe(fx.expect.level);
            }
        });

        test('every writable property resolves to one service call', () => {
            for (const [key, expected] of Object.entries(
                fx.expect.writes ?? {}
            )) {
                expect(
                    haPropertyToService(domain, key, expected.value)
                ).toEqual({
                    domain: expected.domain,
                    service: expected.service,
                    data: expected.data,
                });
            }
        });

        test('read-only / untranslatable properties never write', () => {
            for (const key of fx.expect.notViaProperties ?? []) {
                expect(haPropertyToService(domain, key, 1)).toBeNull();
            }
        });

        test('a panel echoing the whole props bag only writes known fields', async () => {
            callService.mockClear();
            const applied = await haApplyPropertyWrites(
                domain,
                state.properties,
                { entity_id: fx.entity.entity_id }
            );

            const known = Object.keys(fx.expect.writes ?? {});
            expect(applied.filter((k) => !known.includes(k))).toEqual([]);
            if (known.length) {
                expect(applied.length).toBeGreaterThan(0);
            }
            expect(callService).toHaveBeenCalledTimes(applied.length);
        });
    });
});
