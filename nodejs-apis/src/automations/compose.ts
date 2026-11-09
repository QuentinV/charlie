/**
 * Natural-language → automation draft.
 *
 * A small router-served model (`LLM_SMALL_TASK_MODEL`, Qwen3-1.7B) with a
 * schema-constrained JSON answer whose enums are closed. On top of that, an
 * evidence rule: a `DEVICE_STATE` trigger names a device, and the name must
 * resolve to a real device in the catalogue — an invented device is dropped,
 * never shipped. The result is a *draft* (no `_id`, not persisted); the user
 * confirms it before it is saved.
 *
 * Re-validate any prompt change the way the repo does: probe the live small
 * model with `npx tsx src/automations/probe.ts` (exports the prompt + schema,
 * no DB involved).
 */
import { z } from 'zod';
import { req, shoppingHost, shoppingModel } from '../ai/llm';
import { log } from '../manager/services/activities';
import { parseLlmContent } from '../shopping/restructure';
import {
    Automation,
    AutomationEdge,
    AutomationNode,
    Device,
    PropertyValue,
} from '../types';

/** Closed enums: constrained decoding makes an out-of-set value impossible. */
export const AUTOMATION_TRIGGER_TYPES = [
    'CRON',
    'DEVICE_STATE',
    'EVENT',
    'MANUAL',
] as const;
export const AUTOMATION_ATTRIBUTES = [
    'power',
    'level',
    'day_night',
] as const;
export const AUTOMATION_ACTION_KINDS = ['action', 'notify'] as const;
export const CONDITION_OPS = ['eq', 'neq', 'gt', 'lt', 'between'] as const;

export const AUTOMATION_SCHEMA = {
    type: 'object',
    properties: {
        name: { type: 'string' },
        triggers: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    type: {
                        type: 'string',
                        enum: [...AUTOMATION_TRIGGER_TYPES],
                    },
                    device: { type: 'string' },
                    attribute: {
                        type: 'string',
                        enum: [...AUTOMATION_ATTRIBUTES],
                    },
                    to: { type: 'string' },
                    cron: { type: 'string' },
                },
                required: ['type'],
            },
        },
        actions: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    kind: {
                        type: 'string',
                        enum: [...AUTOMATION_ACTION_KINDS],
                    },
                    text: { type: 'string' },
                },
                required: ['kind', 'text'],
            },
        },
        conditions: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    device: { type: 'string' },
                    attribute: {
                        type: 'string',
                        enum: [...AUTOMATION_ATTRIBUTES],
                    },
                    op: { type: 'string', enum: [...CONDITION_OPS] },
                    value: { type: 'string' },
                },
                required: ['device', 'attribute', 'op'],
            },
        },
    },
    required: ['name', 'triggers', 'actions'],
};

export const COMPOSE_PROMPT = [
    'Tu transformes une phrase en une automatisation de maison.',
    'Réponds UNIQUEMENT avec le JSON, sans texte autour :',
    '{"name","triggers":[{"type","device","attribute","to","cron"}],"actions":[{"kind","text"}]}.',
    'Règles :',
    '- triggers[].type :',
    '  * CRON = l heure OU la répétition est donnée ("à 9h", "tous les jours",',
    '    "chaque matin", "à 7h30"). Remplis cron (champs "minute heure * * *",',
    '    ex. 9h -> "00 9 * * *") et NE mets NI device NI attribute NI to.',
    '  * DEVICE_STATE = SEULEMENT "quand <appareil> s allume / s éteint /',
    '    change" (aucune heure). Remplis device + attribute + to.',
    '  * EVENT = une action se termine. MANUAL = déclenchement à la main.',
    '  Si une heure ET un appareil sont dans la phrase, choisis CRON.',
    '- device : recopie le NOM COMPLET d un appareil de la liste, tel quel et en',
    '  entier ("Volet salon", jamais "Salon" ni "volet du salon"). N invente',
    '  JAMAIS un appareil qui n est pas dans la liste.',
    '- attribute : "power" pour allumer/éteindre (to: "on" ou "off"), "level"',
    '  pour un pourcentage, "day_night" UNIQUEMENT pour le soleil (to: "Jour"',
    '  ou "Nuit"). Le verbe "s allume" donne power=on, jamais day_night.',
    '- to : la valeur visée ("on", "off", ou un nombre).',
    '- actions[].kind : "action" (un ordre exécuté par la maison) ou "notify"',
    '  (une notification).',
    '- actions[].text : l ordre en français, comme un humain le dirait.',
    '- conditions (facultatif) : ce que la maison doit vérifier avant d agir.',
    '  device (nom exact), attribute (power/level/day_night), op (eq, neq, gt,',
    '  lt, between), value (la valeur ; pour between : "min-max").',
    '- Une seule automatisation, jamais d appareil ni d action inventés.',
    'Exemples :',
    '- "quand la lumière du salon s allume, préviens-moi" ->',
    '  {"name":"Salon allumé","triggers":[{"type":"DEVICE_STATE","device":"Lumière du salon","attribute":"power","to":"on"}],"actions":[{"kind":"notify","text":"La lumière du salon est allumée"}]}',
    '- "quand le soleil se lève, ouvre les volets" ->',
    '  {"name":"Lever du soleil","triggers":[{"type":"DEVICE_STATE","device":"Météo","attribute":"day_night","to":"Jour"}],"actions":[{"kind":"action","text":"ouvre les volets"}]}',
    '- "à 7h30, allume la cuisine" ->',
    '  {"name":"Réveil cuisine","triggers":[{"type":"CRON","cron":"30 7 * * *"}],"actions":[{"kind":"action","text":"allume la lumière de la cuisine"}]}',
    '- "ouvre le volet du salon à 9h tous les jours" ->',
    '  {"name":"Ouvrir volet salon","triggers":[{"type":"CRON","cron":"00 9 * * *"}],"actions":[{"kind":"action","text":"ouvre le volet salon"}]}',
].join('\n');

/** Tolerant validation of the model answer (unknown fields are ignored). */
const Draft = z.object({
    name: z.string().optional(),
    triggers: z
        .array(
            z.object({
                type: z.string(),
                device: z.string().nullish(),
                attribute: z.string().nullish(),
                to: z.string().nullish(),
                cron: z.string().nullish(),
                event: z.string().nullish(),
            })
        )
        .default([]),
    actions: z
        .array(
            z.object({
                kind: z.string(),
                text: z.string(),
            })
        )
        .default([]),
    conditions: z
        .array(
            z.object({
                device: z.string().nullish(),
                attribute: z.string().nullish(),
                op: z.string().nullish(),
                value: z.string().nullish(),
            })
        )
        .default([]),
});

type RawDraft = z.infer<typeof Draft>;

/** Lower-case, accent-folded, trimmed — for loose device-name matching. */
function norm(value: unknown): string {
    return String(value ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

/** French words that carry no device identity ("volet DU salon"). */
const FR_STOPWORDS = new Set([
    'de',
    'du',
    'des',
    'la',
    'le',
    'les',
    'l',
    'au',
    'aux',
    'd',
    'un',
    'une',
    'a',
    'et',
    'the',
    'of',
]);

/** Significant words of a name: folded, without the uninformative particles. */
export function significantWords(value: unknown): string[] {
    return norm(value)
        .split(/[^a-z0-9]+/)
        .filter((word) => word && !FR_STOPWORDS.has(word));
}

/** True when two names carry exactly the same significant words. */
function sameName(a: unknown, b: unknown): boolean {
    const wa = significantWords(a).sort();
    const wb = significantWords(b).sort();
    return (
        wa.length > 0 &&
        wa.length === wb.length &&
        wa.every((word, i) => word === wb[i])
    );
}

/**
 * Resolve a spoken device name to a real device, or nothing (never invent).
 *
 * Scored on significant words, not raw substrings: "volet du salon" is an exact
 * match for "Volet salon" (both reduce to {volet, salon}) and outranks "Salon
 * clim" (shares only {salon}). The old substring test returned whichever room
 * word matched first — how a shutter ended up pointing at a clim.
 */
export function resolveDevice(
    name: string | undefined,
    devices: Device[]
): Device | undefined {
    const target = significantWords(name);
    if (!target.length) return undefined;
    const targetSet = new Set(target);

    let best: Device | undefined;
    let bestScore = 0;
    for (const device of devices ?? []) {
        const candidate = significantWords(device.name);
        if (!candidate.length) continue;
        if (sameName(name, device.name)) return device;

        let shared = 0;
        for (const word of candidate) {
            if (targetSet.has(word)) shared += 1;
        }
        if (shared > bestScore) {
            bestScore = shared;
            best = device;
        }
    }
    return bestScore > 0 ? best : undefined;
}

/** "on"/"off" stay strings, "12" becomes 12 (a level). */
function coerceValue(raw: string | null | undefined): PropertyValue | undefined {
    const value = (raw ?? '').trim();
    if (!value) return undefined;
    const n = Number(value);
    return Number.isFinite(n) && value !== '' ? n : value;
}

/** "15-25" → [15, 25] for a `between` condition; undefined when unparseable. */
function parseRange(raw: string | null | undefined): number[] | undefined {
    const nums = (raw ?? '')
        .split(/[^0-9.]+/)
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isFinite(n));
    return nums.length >= 2 ? [nums[0], nums[1]] : undefined;
}

/** `day_night` value → the equivalent `power` value (the sun slip). */
const DAY_TO_POWER: Record<string, PropertyValue> = {
    jour: 'on',
    day: 'on',
    nuit: 'off',
    night: 'off',
};

/**
 * Attributes a device can actually express: `power`/`level` (every actuatable
 * device) plus whatever its last-known `properties` carry (e.g. `day_night` on
 * the météo device). Used both to hint the model and to validate its answer —
 * the same "evidence over the model's guess" rule the shopping list uses.
 */
export function deviceAttributes(device: Device): Set<string> {
    const set = new Set<string>(['power', 'level']);
    for (const key of Object.keys(device?.state?.properties ?? {})) {
        set.add(key);
    }
    return set;
}

/**
 * Evidence check for a device-state attribute. If the device exposes it, keep
 * it. Otherwise the classic small-model slip — `day_night` (sun) on a light —
 * is remapped to the matching `power` value ("Jour" → "on"), with a warning;
 * any other unsupported attribute falls back to `power` too. Nowhere to fall
 * back to (no `power`) keeps the raw attribute so nothing is silently lost.
 */
export function normalizeAttribute(
    device: Device,
    attribute: string,
    value: PropertyValue | undefined
): { attribute: string; value?: PropertyValue; warning?: string } {
    const available = deviceAttributes(device);
    if (available.has(attribute)) return { attribute, value };

    if (attribute === 'day_night' && available.has('power')) {
        const mapped =
            typeof value === 'string'
                ? DAY_TO_POWER[value.toLowerCase()]
                : undefined;
        return {
            attribute: 'power',
            value: mapped,
            warning: `day_night non exposé par ${device.name} → power${
                mapped ? ` (${mapped})` : ''
            }`,
        };
    }

    if (available.has('power')) {
        return {
            attribute: 'power',
            value,
            warning: `attribut "${attribute}" non exposé par ${device.name} → power`,
        };
    }

    return { attribute, value };
}

/** Requests to be informed, which are a `notify` even if typed as `action`. */
const NOTIFY_HINTS = [
    'previens',
    'notifie',
    'avertis',
    'informe-moi',
    'informe moi',
    'alerte',
    'un message',
];

/** True when the action text asks to be told something (a notification). */
export function looksLikeNotify(text: string): boolean {
    const folded = norm(text);
    return NOTIFY_HINTS.some((hint) => folded.includes(hint));
}

export interface ComposeResult {
    automation: Automation;
    warnings: string[];
}

/**
 * Turn a validated draft into a graph: each trigger → the first action, then
 * actions chained in order (`success`). A DEVICE_STATE trigger whose device
 * cannot be resolved is dropped with a warning — the one thing the small model
 * most likes to invent.
 */
export function buildAutomation(
    draft: RawDraft,
    devices: Device[]
): ComposeResult {
    const warnings: string[] = [];
    const nodes: AutomationNode[] = [];
    const edges: AutomationEdge[] = [];
    const triggerIds: string[] = [];
    const actionIds: string[] = [];

    let t = 0;
    for (const raw of draft.triggers ?? []) {
        const type = (AUTOMATION_TRIGGER_TYPES as readonly string[]).includes(
            raw.type
        )
            ? (raw.type as (typeof AUTOMATION_TRIGGER_TYPES)[number])
            : undefined;
        if (!type) continue;

        const node: AutomationNode = { id: `t${++t}`, kind: 'trigger' };
        if (type === 'DEVICE_STATE') {
            const device = resolveDevice(raw.device ?? undefined, devices);
            if (!device?._id) {
                warnings.push(`Unknown device: ${raw.device ?? '?'}`);
                continue;
            }
            if (!sameName(raw.device, device.name)) {
                warnings.push(
                    `Approximate device: "${raw.device ?? '?'}" → ${device.name}`
                );
            }
            const requested = (
                AUTOMATION_ATTRIBUTES as readonly string[]
            ).includes(raw.attribute ?? '')
                ? (raw.attribute as string)
                : 'power';
            const normalized = normalizeAttribute(
                device,
                requested,
                coerceValue(raw.to)
            );
            if (normalized.warning) warnings.push(normalized.warning);
            node.trigger = {
                type,
                device: {
                    deviceId: device._id,
                    attribute: normalized.attribute,
                    ...(normalized.value !== undefined
                        ? { to: normalized.value }
                        : {}),
                },
            };
        } else if (type === 'CRON') {
            node.trigger = {
                type,
                cron: { expression: raw.cron?.trim() || '00 09 * * *' },
            };
        } else if (type === 'EVENT') {
            node.trigger = {
                type,
                ...(raw.event?.trim() ? { event: raw.event.trim() } : {}),
            };
        } else {
            node.trigger = { type: 'MANUAL' };
        }

        nodes.push(node);
        triggerIds.push(node.id);
    }

    let a = 0;
    for (const raw of draft.actions ?? []) {
        const text = (raw.text ?? '').trim();
        if (!text) continue;
        // A request to be told something is a notification, even if the model
        // typed it as an action ("préviens-moi").
        const isNotify = raw.kind === 'notify' || looksLikeNotify(text);
        if (isNotify) {
            const node: AutomationNode = {
                id: `n${++a}`,
                kind: 'notify',
                notify: { body: text },
            };
            nodes.push(node);
            actionIds.push(node.id);
        } else {
            const node: AutomationNode = {
                id: `a${++a}`,
                kind: 'action',
                action: { text },
            };
            nodes.push(node);
            actionIds.push(node.id);
        }
    }

    // Conditions gate the branch: placed in series so every one must hold
    // (AND). An unknown device is dropped with a warning, like a trigger.
    const conditionIds: string[] = [];
    let c = 0;
    for (const raw of draft.conditions ?? []) {
        const device = resolveDevice(raw.device ?? undefined, devices);
        if (!device?._id) {
            warnings.push(`Unknown device: ${raw.device ?? '?'}`);
            continue;
        }
        if (!sameName(raw.device, device.name)) {
            warnings.push(
                `Approximate device: "${raw.device ?? '?'}" → ${device.name}`
            );
        }
        const op = (CONDITION_OPS as readonly string[]).includes(raw.op ?? '')
            ? (raw.op as (typeof CONDITION_OPS)[number])
            : 'eq';
        const requested = (AUTOMATION_ATTRIBUTES as readonly string[]).includes(
            raw.attribute ?? ''
        )
            ? (raw.attribute as string)
            : 'power';
        const normalized = normalizeAttribute(
            device,
            requested,
            op === 'between' ? undefined : coerceValue(raw.value)
        );
        if (normalized.warning) warnings.push(normalized.warning);
        const value =
            op === 'between' ? parseRange(raw.value) : normalized.value;

        const node: AutomationNode = {
            id: `c${++c}`,
            kind: 'condition',
            condition: {
                deviceId: device._id,
                attribute: normalized.attribute,
                op,
                ...(value !== undefined ? { value } : {}),
            },
        };
        nodes.push(node);
        conditionIds.push(node.id);
    }

    // Wire it: every trigger enters the first condition (or the first action),
    // conditions chain on success, the last one gates the first action, then
    // actions chain on success.
    const entry = conditionIds[0] ?? actionIds[0];
    if (entry) {
        for (const id of triggerIds) edges.push({ from: id, to: entry });
    }
    for (let i = 0; i < conditionIds.length - 1; i++) {
        edges.push({
            from: conditionIds[i],
            to: conditionIds[i + 1],
            when: 'success',
        });
    }
    if (conditionIds.length && actionIds[0]) {
        edges.push({
            from: conditionIds[conditionIds.length - 1],
            to: actionIds[0],
            when: 'success',
        });
    }
    for (let i = 0; i < actionIds.length - 1; i++) {
        edges.push({
            from: actionIds[i],
            to: actionIds[i + 1],
            when: 'success',
        });
    }

    return {
        automation: {
            name: draft.name?.trim() || 'Automation',
            active: true,
            nodes,
            edges,
        },
        warnings,
    };
}

/** Ask the small model to draft an automation from a sentence. */
export async function composeAutomation(
    text: string,
    devices: Device[]
): Promise<ComposeResult> {
    const catalogue = (devices ?? [])
        .map((d) => {
            const attrs = [...deviceAttributes(d)].join(', ');
            return `- ${d.name} (${d.type}) · états: ${attrs}`;
        })
        .join('\n');

    const response = await req(
        {
            messages: [
                { role: 'system', content: COMPOSE_PROMPT },
                {
                    role: 'user',
                    content: `Appareils disponibles :\n${catalogue}\n\nDemande :\n${text}`,
                },
            ],
            tools: [],
            model: shoppingModel(),
            // Drafting is extraction: greedy decoding, bounded answer.
            temperature: 0,
            max_tokens: 512,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'automation_draft',
                    schema: AUTOMATION_SCHEMA,
                },
            },
        },
        shoppingHost()
    );

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('empty answer from the compose model');
    }

    let draft: RawDraft;
    try {
        draft = Draft.parse(parseLlmContent(content));
    } catch {
        throw new Error('the compose model did not return an automation');
    }

    const result = buildAutomation(draft, devices);
    log(
        'AUTOMATIONS',
        `Composed a draft: ${result.automation.name} (${result.automation.nodes.length} nodes)`
    );
    return result;
}

