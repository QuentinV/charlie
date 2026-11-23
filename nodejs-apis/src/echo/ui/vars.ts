import { loadDevice, resolveDeviceProperty } from '../screensUpdates';

/**
 * Resolve `external.*` variables for the device's pull API.
 *
 * The device asks for a batch of paths (`GET /echo/:id/ui/vars?p=…&p=…`) and
 * renders the answers without blocking its UI task. Charlie is the only side
 * that knows how to read a device document, so it does the lookup here and the
 * device caches the result for the ttl declared in its bundle.
 *
 * Path grammar (`external.devices.<Name>.<path>`) mirrors the placeholder
 * syntax the existing `screensUpdates` refresh already resolves, so both code
 * paths share one 1 s device cache and one state refresh per wave.
 */

export interface ResolvedVars {
    /** Path -> printable value. Only paths that resolved. */
    values: Record<string, string>;
    /** Paths whose device answered but whose value is missing. */
    missing: string[];
    /** Paths Charlie cannot resolve at all (unknown namespace, bad grammar). */
    unsupported: string[];
}

const DEVICE_PREFIX = 'external.devices.';

/** `external.devices.Chambre.state.level` -> `{ name: 'Chambre', path: 'state.level' }`. */
export function parseDeviceVarPath(
    varPath: string
): { name: string; path: string } | null {
    if (!varPath.startsWith(DEVICE_PREFIX)) {
        return null;
    }
    const rest = varPath.slice(DEVICE_PREFIX.length);
    const dot = rest.indexOf('.');
    if (dot <= 0 || dot === rest.length - 1) {
        return null;
    }
    return { name: rest.slice(0, dot), path: rest.slice(dot + 1) };
}

/** Render a resolved value the way the device would print it. */
function printable(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return '';
    if (typeof value === 'number') {
        return Number.isInteger(value) ? String(value) : String(value);
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

/**
 * Resolve a batch of variable paths.
 *
 * `core.*` paths are device-local and are reported as `unsupported` when they
 * arrive here — the device should never ask, but a buggy bundle should not make
 * the whole request fail.
 */
export async function resolveVars(paths: string[]): Promise<ResolvedVars> {
    const result: ResolvedVars = { values: {}, missing: [], unsupported: [] };
    const unique = Array.from(new Set(paths.map((p) => String(p).trim()))).filter(
        Boolean
    );

    for (const varPath of unique) {
        const parsed = parseDeviceVarPath(varPath);
        if (!parsed) {
            result.unsupported.push(varPath);
            continue;
        }
        const entry = await loadDevice(parsed.name);
        if (!entry) {
            result.missing.push(varPath);
            continue;
        }
        const value = resolveDeviceProperty(entry, parsed.path);
        if (value === undefined) {
            result.missing.push(varPath);
            continue;
        }
        result.values[varPath] = printable(value);
    }

    return result;
}
