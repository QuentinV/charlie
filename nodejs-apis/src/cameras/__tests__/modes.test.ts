/**
 * The vision modes: the closed table, the stored CSV and the resolver.
 *
 * Pure — this is where "what a mode means" lives, so the invariants are pinned
 * here (the provider only stores the CSV, the feed only consumes the tables).
 */
import {
    VISION_MODES,
    VISION_MODE_IDS,
    visionGrocery,
    visionModeOf,
    visionModeOptions,
    visionModesCsv,
    visionModesOf,
    visionPolicyOf,
} from '../modes';

/** A selection, the way the device stores it. */
const ids = (...list: string[]) => visionModesOf(list.join(','));

describe('the table', () => {
    it('has unique lowercase ids, a label, a hint and classes each', () => {
        expect(VISION_MODE_IDS).toEqual([...new Set(VISION_MODE_IDS)]);
        for (const mode of VISION_MODES) {
            expect(mode.id).toBe(mode.id.toLowerCase());
            expect(mode.label).toBeTruthy();
            expect(mode.hint).toBeTruthy();
            expect(mode.classes.length).toBeGreaterThan(0);
        }
    });

    it('has no `off` row: an empty selection IS the off state', () => {
        expect(VISION_MODE_IDS).not.toContain('off');
        expect(visionModesOf('')).toEqual([]);
        expect(visionModesOf(undefined)).toEqual([]);
    });

    it('looks at the shelves in at most one mode (no ambiguity for the fridge flow)', () => {
        expect(VISION_MODES.filter((mode) => mode.grocery)).toHaveLength(1);
    });

    it('pins what each shipped mode means', () => {
        const byId = Object.fromEntries(VISION_MODES.map((m) => [m.id, m]));

        expect(byId.presence.classes).toEqual(['person']);
        expect(byId.presence.dwellS).toBe(15);
        expect(byId.presence.escalate).toBe(true);

        // The whole point of per-class escalation: a `pet` camera never pays a
        // VLM call, whatever else it watches.
        expect(byId.pet.classes).toEqual(['cat', 'dog']);
        expect(byId.pet.escalate).toBeUndefined();

        // `entrance` is the short-dwell mode, so it must be the shortest.
        expect(byId.entrance.dwellS).toBeLessThan(byId.presence.dwellS);

        expect(byId.grocery.grocery).toBe(true);
        expect(byId.commands.gestures).toBe(true);
    });

    it('exposes the panel options (label + hint per mode)', () => {
        const options = visionModeOptions();
        expect(options.map((option) => option.value)).toEqual(VISION_MODE_IDS);
        expect(options[0]).toEqual({
            value: VISION_MODES[0].id,
            label: VISION_MODES[0].label,
            description: VISION_MODES[0].hint,
        });
    });
});

describe('visionPolicyOf', () => {
    it('unions the classes and keeps the shortest dwell per class', () => {
        const policy = visionPolicyOf(ids('presence', 'entrance'));
        expect(policy.classes).toEqual(['person']);
        // `entrance` (3 s) wins over `presence` (15 s): earliest signal first.
        expect(policy.dwellByClass).toEqual({ person: 3 });
    });

    it('escalates only the classes an escalating mode watches', () => {
        const policy = visionPolicyOf(ids('presence', 'pet'));
        expect(policy.classes).toEqual(['person', 'cat', 'dog']);
        expect(policy.escalateClasses).toEqual(['person']);
        expect(policy.dwellByClass).toEqual({ person: 15, cat: 10, dog: 10 });
    });

    it('tags every class with the modes that watch it', () => {
        expect(visionPolicyOf(ids('entrance', 'grocery')).modesByClass).toEqual({
            person: ['entrance', 'grocery'],
        });
    });

    it('asks for gestures only when a selected mode does', () => {
        expect(visionPolicyOf(ids('presence')).gestureModes).toEqual([]);
        expect(
            visionPolicyOf(ids('presence', 'commands')).gestureModes
        ).toEqual(['commands']);
    });

    it('resolves an empty selection to an empty policy', () => {
        expect(visionPolicyOf([])).toEqual({
            classes: [],
            dwellByClass: {},
            escalateClasses: [],
            gestureModes: [],
            modesByClass: {},
        });
    });
});

describe('the stored CSV', () => {
    it('folds case, spaces and duplicates, and keeps table order', () => {
        expect(visionModesOf(' Grocery , presence ,grocery').map((m) => m.id)).toEqual(
            ['presence', 'grocery']
        );
        expect(visionModesCsv('grocery,presence')).toBe('presence,grocery');
    });

    it('drops unknown ids: a mode removed from the table is not a crash', () => {
        expect(visionModesOf('presence,nope,off').map((m) => m.id)).toEqual([
            'presence',
        ]);
        expect(visionModesCsv('nope')).toBe('');
    });

    it('accepts a non-string value (a legacy or hand-edited document)', () => {
        expect(visionModesOf(null)).toEqual([]);
        expect(visionModesOf(42)).toEqual([]);
        expect(visionModesOf({ presence: true })).toEqual([]);
    });
});

describe('visionModeOf / visionGrocery', () => {
    it('finds one mode, case-insensitively', () => {
        expect(visionModeOf('PET')?.id).toBe('pet');
        expect(visionModeOf(' pet ')?.id).toBe('pet');
        expect(visionModeOf('nope')).toBeUndefined();
        expect(visionModeOf(undefined)).toBeUndefined();
    });

    it('finds the mode that looks at the shelves', () => {
        expect(visionGrocery(ids('presence'))).toBeUndefined();
        expect(visionGrocery(ids('presence,grocery'))?.id).toBe('grocery');
    });
});
