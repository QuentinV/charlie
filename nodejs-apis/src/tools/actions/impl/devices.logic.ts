/**
 * Pure helpers for **partial** device moves — the NLU "nuance" feature
 * ("ferme un peu le volet", "ouvre beaucoup le volet").
 *
 * A nuance turns into a SIGNED level change applied to the device's current
 * level: opening raises it, closing lowers it. The sign is the whole point — a
 * signed value (`-10`) means "move by", an unsigned one is an absolute target,
 * exactly the distinction the action makes when it reads `slots.number`.
 */

import { PowerType } from "../../../types";

/** Level change (0..100 scale) carried by each nuance word. */
export const NUANCE_STEPS: Record<string, number> = {
    slightly: 10,
    strongly: 40,
};

/** Signed representation of a level change (`+10`, `-10`). */
export function signedLevel(delta: number): string {
    return delta >= 0 ? `+${delta}` : `${delta}`;
}

/** Whether a number slot value is a relative change (`+10` / `-10`). */
export function isRelativeLevel(raw?: string): boolean {
    return !!raw && /^[+-]/.test(raw.trim());
}

/**
 * Signed level change for a nuance word on a move: opening raises the level,
 * closing lowers it. `undefined` when there is no nuance (a plain full move).
 */
export function nuanceDelta(
    power: PowerType,
    nuance?: string
): number | undefined {
    const step = NUANCE_STEPS[nuance ?? 'NONE'];
    if (!step) return undefined;
    return power === 'on' ? step : power === 'off' ? -step : undefined;
}

/** Apply a signed change to a current level, clamped to the 0..100 scale. */
export function applyDelta(current: number, delta: number): number {
    return Math.max(0, Math.min(100, Math.round(current + delta)));
}
