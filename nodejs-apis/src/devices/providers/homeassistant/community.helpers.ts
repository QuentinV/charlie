import 'dotenv/config';
import path from 'path';

// =====================================================================
// Pure helpers for the community (HACS-compatible) installer.
// Kept dependency-free so they can be unit-tested without pulling in the
// DB / uuid / network layers (community.ts wires them to the real world).
// =====================================================================

export const HA_CONFIG_DIR =
    process.env.HA_CONFIG_DIR ?? '../homeassistant/config';
export const CUSTOM_COMPONENTS_DIR = path.join(
    HA_CONFIG_DIR,
    'custom_components'
);

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Parse the HACS default `integration` file into a list of `owner/repo`. */
export function parseCatalog(raw: string): string[] {
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((r) => typeof r === 'string' && REPO_RE.test(r.trim()))
            .map((r) => r.trim());
    } catch {
        return [];
    }
}

/** Normalize `owner/repo`, a GitHub URL or a `.git` URL into `owner/repo`. */
export function normalizeRepo(input: string): string | null {
    if (!input || typeof input !== 'string') return null;
    let s = input.trim();
    s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
    s = s.replace(/\.git$/i, '');
    s = s.replace(/[?#].*$/, '');
    const parts = s.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const repo = `${parts[0]}/${parts[1]}`;
    return REPO_RE.test(repo) ? repo : null;
}

export interface HacsManifest {
    contentInRoot: boolean;
    zipRelease: boolean;
    filename?: string;
    name?: string;
}

/** Parse a repo's `hacs.json` (all fields optional). */
export function parseHacsManifest(raw: any): HacsManifest {
    const obj = raw && typeof raw === 'object' ? raw : {};
    return {
        contentInRoot: obj.content_in_root === true,
        zipRelease: obj.zip_release === true,
        filename: typeof obj.filename === 'string' ? obj.filename : undefined,
        name: typeof obj.name === 'string' ? obj.name : undefined,
    };
}

/**
 * Detect the integration domain(s) from a repo-relative file listing using the
 * standard HACS layout: `custom_components/<domain>/manifest.json`.
 * Returns `[]` when the repo uses `content_in_root` (handled by the caller).
 */
export function detectComponentDomains(files: string[]): string[] {
    const domains = new Set<string>();
    const re = /(?:^|\/)custom_components\/([^/]+)\/manifest\.json$/;
    for (const f of files) {
        const m = f.match(re);
        if (m) domains.add(m[1]);
    }
    return [...domains];
}
