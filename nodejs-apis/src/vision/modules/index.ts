/**
 * Registry of the document types Charlie understands — the vision equivalent of
 * `devices/providers/index.ts`: one entry per module file, and every consumer
 * (classifier enum, catalogue, extraction, UI picker) derives from it.
 *
 * Adding a type: write `modules/<type>.ts` exporting a `VisionModule` and add it
 * here. Nothing else needs to know about it — a document type is data, not a
 * code path.
 */
import generic from './generic';
import recipe from './recipe';
import { VisionModule } from './types';

export const VISION_MODULES: { [id: string]: VisionModule<any> } = {
    recipe,
    generic,
};

/** Modules the classifier may return (the fallback is not one of them). */
export function classifierModules(): VisionModule<any>[] {
    return Object.values(VISION_MODULES).filter((m) => !m.fallback);
}

/** A module by id, undefined when the id is unknown. */
export function getVisionModule(id?: string): VisionModule<any> | undefined {
    return id ? VISION_MODULES[id] : undefined;
}

/** The fallback (`unknown` → a free description). */
export function fallbackModule(): VisionModule<any> {
    return (
        Object.values(VISION_MODULES).find((m) => m.fallback) ?? generic
    );
}

/**
 * What a client needs to pick a type by hand (the UI's chips, an MCP tool):
 * the id, the French label and a one-line description.
 */
export function visionModuleCatalogue() {
    return classifierModules().map((m) => ({
        id: m.id,
        label: m.label,
        hint: m.hint,
        actions: (m.actions ?? []).map((a) => ({ id: a.id, label: a.label })),
    }));
}

export default VISION_MODULES;
