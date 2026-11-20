/**
 * The vision modes: the closed table of behaviours a camera can be given.
 *
 * A mode is a **preset**, not a knob. It carries the classes worth watching, the
 * dwell that counts as "staying", the gap between two looks at the shelves, and
 * whether the camera escalates to the vision model or listens for hand gestures.
 * This table is the whole vocabulary: `vision-feed` never learns a class, a dwell
 * or a zone from anywhere else, and no camera stores a policy of its own.
 *
 * A camera **selects several modes** (`device.properties.visionModes`, a CSV of
 * ids), so a selection resolves to *one* per-class policy (`visionPolicyOf`): one
 * cascade per camera, one detector, one tracker — the container never runs an
 * engine per mode. The per-class tables are what keep a `pet` camera from paying
 * a VLM call for a cat just because `presence` escalates.
 *
 * Pure: no I/O, no settings, no DB. The provider stores the CSV, the brain
 * resolves it (`cameras/index.ts`), `vision-feed` consumes the tables.
 */

/** One behaviour a camera can be given. */
export interface VisionMode {
    id: string;
    label: string;
    /** One line for the panel: what selecting this mode actually does. */
    hint: string;
    /** COCO classes worth watching (empty = everything). */
    classes: string[];
    /** Staying this long is a `dwell` (omitted = the feed's default). */
    dwellS?: number;
    /** Gap between two looks at the shelves (grocery mode). */
    cooldownS?: number;
    /** Ask the vision model to describe the frame (rare: only on an event). */
    escalate?: boolean;
    /** Look at the shelves and append what is seen to the shopping list. */
    grocery?: boolean;
    /** Listen for hand gestures (needs mediapipe + a model in the container). */
    gestures?: boolean;
}

/**
 * Every mode, in display (and resolution) order. Selecting none = the camera is
 * not analysed at all: there is deliberately no `off` row, so "no mode" cannot
 * be confused with a mode that does nothing.
 */
export const VISION_MODES: VisionMode[] = [
    {
        id: 'presence',
        label: 'Présence',
        hint: 'Signale une personne qui reste dans la pièce.',
        classes: ['person'],
        dwellS: 15,
        cooldownS: 60,
        escalate: true,
    },
    {
        id: 'pet',
        label: 'Animal',
        hint: 'Signale un chat ou un chien qui reste dans la pièce.',
        classes: ['cat', 'dog'],
        dwellS: 10,
        cooldownS: 120,
    },
    {
        id: 'entrance',
        label: 'Entrée / intrusion',
        hint: "Signale une arrivée tout de suite (3 s), pour une alarme.",
        classes: ['person'],
        dwellS: 3,
        cooldownS: 60,
        escalate: true,
    },
    {
        id: 'grocery',
        label: 'Courses (frigo, placard)',
        hint: "Regarde les étagères et ajoute ce qu'il voit à la liste de courses.",
        classes: ['person'],
        dwellS: 20,
        cooldownS: 300,
        escalate: true,
        grocery: true,
    },
    {
        id: 'commands',
        label: 'Commandes gestuelles',
        hint: 'Réagit aux gestes de la main (pouce levé, poing, victoire, OK, doigts levés, salut de la main, balayages…).',
        classes: ['person'],
        dwellS: 60,
        cooldownS: 60,
        gestures: true,
    },
];

/** The mode ids, in table order (the stored CSV is validated against these). */
export const VISION_MODE_IDS = VISION_MODES.map((mode) => mode.id);

/** One mode by id, or undefined for an unknown / legacy value. */
export function visionModeOf(id?: unknown): VisionMode | undefined {
    const key = String(id ?? '')
        .trim()
        .toLowerCase();
    return VISION_MODES.find((mode) => mode.id === key);
}

/**
 * The modes a camera selected, from the stored CSV
 * (`device.properties.visionModes`).
 * Tolerant like every other stored CSV: trimmed, case-folded, de-duplicated and
 * unknown ids dropped — and always returned in **table order**, so two cameras
 * that picked the same modes in a different order resolve to the same policy.
 */
export function visionModesOf(value: unknown): VisionMode[] {
    const ids = new Set(
        String(value ?? '')
            .split(',')
            .map((id) => id.trim().toLowerCase())
            .filter(Boolean)
    );
    return VISION_MODES.filter((mode) => ids.has(mode.id));
}

/** The canonical CSV of a selection — what the provider stores. */
export function visionModesCsv(value: unknown): string {
    return visionModesOf(value)
        .map((mode) => mode.id)
        .join(',');
}

/**
 * What `vision-feed` consumes for one camera: the per-class tables of a
 * selection. Not a merge into one `(classes, dwell, escalate)` triple — the
 * classes keep their own dwell and their own escalation, and every class knows
 * which modes asked for it (the event is tagged with them).
 */
export interface VisionPolicy {
    /** Union of the selected modes' classes, in table order (empty = all). */
    classes: string[];
    /** Per-class dwell; a class with no row uses the feed's default. */
    dwellByClass: { [cls: string]: number };
    /** Classes an escalating mode watches — the only ones worth a VLM call. */
    escalateClasses: string[];
    /**
     * The selected modes that listen for hand gestures. Doubles as the flag (an
     * empty list = no gesture recognizer loaded) and as the tag a `gesture`
     * event carries — a gesture is not a COCO class, so `modesByClass` cannot
     * answer for it.
     */
    gestureModes: string[];
    /** Class → the selected modes that watch it (event tagging). */
    modesByClass: { [cls: string]: string[] };
}

/**
 * Resolve a selection (the output of `visionModesOf`) into the per-class policy.
 *
 * - classes: the union, in table order;
 * - dwell: the **shortest** dwell among the modes watching that class — the
 *   earliest signal wins, and a mode without a dwell contributes nothing (so
 *   `entrance` (3 s) + `presence` (15 s) on `person` fires at 3 s; an automation
 *   that wants a longer wait adds its own delay);
 * - escalation: only the classes of the escalating modes, never the whole union;
 * - gestures: `gestureModes` lists the selected modes that want them (empty =
 *   none), which is also the tag a `gesture` event carries;
 * - grocery: brain-side only (`visionGrocery`), never sent to the feed.
 */
export function visionPolicyOf(modes: VisionMode[]): VisionPolicy {
    const classes: string[] = [];
    const dwellByClass: { [cls: string]: number } = {};
    const escalateClasses: string[] = [];
    const modesByClass: { [cls: string]: string[] } = {};

    for (const mode of modes) {
        for (const cls of mode.classes) {
            if (!classes.includes(cls)) classes.push(cls);

            const named = modesByClass[cls] ?? (modesByClass[cls] = []);
            if (!named.includes(mode.id)) named.push(mode.id);

            if (mode.escalate && !escalateClasses.includes(cls)) {
                escalateClasses.push(cls);
            }

            const dwell = mode.dwellS;
            if (typeof dwell === 'number' && dwell > 0) {
                const current = dwellByClass[cls];
                if (current === undefined || dwell < current) {
                    dwellByClass[cls] = dwell;
                }
            }
        }
    }

    return {
        classes,
        dwellByClass,
        escalateClasses,
        gestureModes: modes
            .filter((mode) => !!mode.gestures)
            .map((mode) => mode.id),
        modesByClass,
    };
}

/**
 * The mode that looks at the shelves, or undefined. Brain-side only (the fridge
 * flow in `cameras/kitchen.ts`): `vision-feed` is a sensor and holds no home
 * policy, so the grocery behaviour never travels to the container.
 */
export function visionGrocery(modes: VisionMode[]): VisionMode | undefined {
    return modes.find((mode) => mode.grocery);
}

/** The `enum` options of the panel's multi-select (a label + one hint each). */
export function visionModeOptions(): {
    value: string;
    label: string;
    description: string;
}[] {
    return VISION_MODES.map((mode) => ({
        value: mode.id,
        label: mode.label,
        description: mode.hint,
    }));
}
