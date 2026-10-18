import 'dotenv/config';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { cs } from '../../../core/db';
import { HttpError } from '../../../errors';
import { settings } from '../../../manager/services/settings';
import { log } from '../../../manager/services/activities';
import {
    ensureHaSession,
    haListFlowHandlers,
    haPing,
    haRestart,
} from './client';

// =====================================================================
// Home Assistant community integrations (HACS-compatible) — installer.
// ---------------------------------------------------------------
// Charlie's HA ships with core integrations only. Community integrations
// (e.g. `krahabb/meross_lan`) live in `custom_components/` and are normally
// installed through HACS. Charlie installs them natively instead (no GitHub
// device flow, no HA UI): the brain downloads the GitHub source, drops
// `custom_components/<domain>` into HA's config dir, then restarts HA so the
// new config-flow handler is registered.
//
// Catalog source: HACS's own default repository list
// (https://github.com/hacs/default/blob/master/integration), a JSON array of
// `owner/repo` strings — the exact set HACS offers, no auth required.
//
// Requires the api container to see HA's config dir (HA_CONFIG_DIR, mounted
// read-write in docker-compose). Extraction uses the system `tar`.
// =====================================================================

// Pure helpers + config paths live in community.helpers (dependency-free, so
// they stay unit-testable without pulling in the DB / uuid / network layers).
export * from './community.helpers';
import {
    CUSTOM_COMPONENTS_DIR,
    HA_CONFIG_DIR,
    detectComponentDomains,
    normalizeRepo,
    parseCatalog,
} from './community.helpers';

const HACS_DEFAULT_INTEGRATION_URL =
    'https://raw.githubusercontent.com/hacs/default/master/integration';
const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'charlie-homeassistant';
const CATALOG_TTL_MS = 60 * 60 * 1000;

// ===== Settings / guards =====

export function communityEnabled(): boolean {
    return (
        settings['devices.providers.homeassistant.community.enabled'] !== false
    );
}

function githubToken(): string {
    return (
        process.env.GITHUB_TOKEN ||
        (settings['devices.providers.homeassistant.community.githubToken'] as
            | string
            | undefined) ||
        ''
    );
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

// ===== Network =====

async function githubFetch(url: string): Promise<any> {
    const token = githubToken();
    const res = await fetch(url, {
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/vnd.github+json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });
    if (res.status === 403 || res.status === 429) {
        throw new HttpError(
            429,
            'GitHub rate limit reached — add a GitHub token in the Home Assistant community settings.'
        );
    }
    if (!res.ok) {
        throw new HttpError(
            res.status === 404 ? 404 : 502,
            `GitHub request failed (${res.status})`
        );
    }
    return res.json();
}

let catalogCache: { at: number; repos: string[] } | null = null;

/** Fetch (and cache) the HACS default community integration catalog. */
export async function getCatalog(force = false): Promise<string[]> {
    if (
        !force &&
        catalogCache &&
        Date.now() - catalogCache.at < CATALOG_TTL_MS
    ) {
        return catalogCache.repos;
    }
    const res = await fetch(HACS_DEFAULT_INTEGRATION_URL, {
        headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) {
        throw new HttpError(502, 'Unable to fetch the community catalog');
    }
    const repos = parseCatalog(await res.text());
    catalogCache = { at: Date.now(), repos };
    return repos;
}

export interface ResolvedRelease {
    ref: string;
    tarballUrl: string;
    version?: string;
}

/** Resolve the GitHub ref + source tarball URL (latest release, else default branch). */
export async function resolveRelease(
    owner: string,
    name: string,
    ref?: string
): Promise<ResolvedRelease> {
    if (ref) {
        return {
            ref,
            tarballUrl: `https://codeload.github.com/${owner}/${name}/tar.gz/${ref}`,
        };
    }
    try {
        const rel = await githubFetch(
            `${GITHUB_API}/repos/${owner}/${name}/releases/latest`
        );
        if (rel?.tag_name) {
            return {
                ref: rel.tag_name,
                version: rel.tag_name,
                tarballUrl: `https://codeload.github.com/${owner}/${name}/tar.gz/${rel.tag_name}`,
            };
        }
    } catch (e) {
        if (e instanceof HttpError && e.httpStatus === 429) throw e;
        // No releases → fall through to the default branch.
    }
    const info = await githubFetch(`${GITHUB_API}/repos/${owner}/${name}`);
    const branch = info?.default_branch ?? 'main';
    return {
        ref: branch,
        tarballUrl: `https://codeload.github.com/${owner}/${name}/tar.gz/${branch}`,
    };
}

// ===== Filesystem =====

function execFileAsync(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(
            cmd,
            args,
            { maxBuffer: 64 * 1024 * 1024 },
            (err, _out, stderr) => {
                if (err) {
                    reject(
                        new Error(`${cmd} failed: ${stderr || err.message}`)
                    );
                } else {
                    resolve();
                }
            }
        );
    });
}

async function downloadToFile(url: string, file: string): Promise<void> {
    const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new HttpError(502, `Download failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(file, buf);
}

async function extractTarGz(file: string, destDir: string): Promise<void> {
    // GNU/BSD tar ships in the node Debian image and on Windows 10+.
    await execFileAsync('tar', ['-xzf', file, '-C', destDir]);
}

async function listRepoFiles(root: string, base = root): Promise<string[]> {
    const out: string[] = [];
    const entries = await fs.readdir(base, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(base, e.name);
        if (e.isDirectory()) {
            out.push(...(await listRepoFiles(root, full)));
        } else {
            out.push(path.relative(root, full).split(path.sep).join('/'));
        }
    }
    return out;
}

async function readJsonIfExists(file: string): Promise<any | null> {
    try {
        return JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch {
        return null;
    }
}

/** Files/dirs that always exist in a real Home Assistant config directory. */
const HA_CONFIG_MARKERS = ['.HA_VERSION', 'configuration.yaml', '.storage'];

export async function looksLikeHaConfigDir(): Promise<boolean> {
    for (const marker of HA_CONFIG_MARKERS) {
        try {
            await fs.access(path.join(HA_CONFIG_DIR, marker));
            return true;
        } catch {
            /* try the next marker */
        }
    }
    return false;
}

/**
 * Guard before any write: fail LOUDLY if HA_CONFIG_DIR is not HA's config dir.
 * Otherwise we would silently `mkdir -p` some unrelated path (e.g. C:\config on
 * Windows, or a container-local dir) and "install" an integration HA never sees
 * — which is exactly how a green chip with `handlerReady:false` happens.
 */
async function ensureWritable(): Promise<void> {
    if (!(await looksLikeHaConfigDir())) {
        throw new HttpError(
            500,
            `HA_CONFIG_DIR ("${HA_CONFIG_DIR}") does not look like Home Assistant's ` +
                `config directory. Point it at the folder mounted as /config in the HA ` +
                `container (Docker: /ha-config via compose; host-run: ../homeassistant/config).`
        );
    }
    try {
        await fs.mkdir(CUSTOM_COMPONENTS_DIR, { recursive: true });
    } catch (e: any) {
        throw new HttpError(
            500,
            `Home Assistant config dir not writable (${CUSTOM_COMPONENTS_DIR}). (${e?.message})`
        );
    }
}

async function copyComponent(src: string, domain: string): Promise<void> {
    if (!/^[A-Za-z0-9_.-]+$/.test(domain)) {
        throw new HttpError(422, `Unsafe integration domain: ${domain}`);
    }
    const dest = path.join(CUSTOM_COMPONENTS_DIR, domain);
    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.cp(src, dest, { recursive: true, force: true });
}

// ===== Public operations =====

export interface CommunityItem {
    repo: string;
    installed: boolean;
}

/** Search the community catalog (and accept a repo/URL directly). */
export async function searchCommunity(query: string): Promise<CommunityItem[]> {
    const q = (query ?? '').trim().toLowerCase();
    const repos = await getCatalog();
    const installed = await listInstalled();
    const installedRepos = new Set(
        installed.map((i) => i.repo).filter(Boolean) as string[]
    );

    let matches = q ? repos.filter((r) => r.toLowerCase().includes(q)) : repos;
    const custom = normalizeRepo(query);
    if (custom && !repos.includes(custom)) matches = [custom, ...matches];

    return matches.slice(0, 50).map((repo) => ({
        repo,
        installed: installedRepos.has(repo),
    }));
}

export interface InstalledCommunity {
    domain: string;
    repo?: string;
    ref?: string;
    version?: string;
    installedAt?: string;
    external?: boolean;
    path: string;
}

/** List community integrations (tracked installs + anything already on disk). */
export async function listInstalled(): Promise<InstalledCommunity[]> {
    const docs = await cs.haCustomIntegrations.find().toArray();
    const byDomain = new Map<string, any>(
        (docs ?? []).map((d: any) => [d.domain, d])
    );

    try {
        const entries = await fs.readdir(CUSTOM_COMPONENTS_DIR, {
            withFileTypes: true,
        });
        for (const e of entries) {
            if (!e.isDirectory() || e.name.startsWith('.')) continue;
            if (byDomain.has(e.name)) continue;
            byDomain.set(e.name, { domain: e.name, external: true });
        }
    } catch {
        /* custom_components may not exist yet */
    }

    return [...byDomain.values()].map((d) => ({
        ...d,
        path: path.join(CUSTOM_COMPONENTS_DIR, d.domain),
    }));
}

export interface InstallResult {
    repo: string;
    ref: string;
    version?: string;
    domains: string[];
    domain: string;
    restartRequired: boolean;
}

/** Install (or update) a community integration from GitHub. */
export async function installCommunity(
    repoInput: string,
    ref?: string
): Promise<InstallResult> {
    const repo = normalizeRepo(repoInput);
    if (!repo) {
        throw new HttpError(
            400,
            'Invalid repository (expected owner/repo or a GitHub URL)'
        );
    }
    const [owner, name] = repo.split('/');

    await ensureWritable();

    const release = await resolveRelease(owner, name, ref);
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'charlie-ha-'));

    try {
        const tarball = path.join(tmp, 'repo.tar.gz');
        await downloadToFile(release.tarballUrl, tarball);

        const extractDir = path.join(tmp, 'x');
        await fs.mkdir(extractDir, { recursive: true });
        await extractTarGz(tarball, extractDir);

        const roots = await fs.readdir(extractDir);
        if (!roots.length) throw new HttpError(500, 'Empty archive');
        const root = path.join(extractDir, roots[0]);

        const relativeFiles = await listRepoFiles(root);
        const domains = detectComponentDomains(relativeFiles);
        const installedNow: { domain: string; version?: string }[] = [];

        if (domains.length) {
            for (const domain of domains) {
                const src = path.join(root, 'custom_components', domain);
                const manifest = await readJsonIfExists(
                    path.join(src, 'manifest.json')
                );
                await copyComponent(src, domain);
                installedNow.push({ domain, version: manifest?.version });
            }
        } else {
            // content_in_root (HACS) or a repo whose root is the integration.
            const manifest = await readJsonIfExists(
                path.join(root, 'manifest.json')
            );
            const domain = manifest?.domain;
            if (!domain) {
                throw new HttpError(
                    422,
                    `No custom_components/<domain> or root manifest.json domain found in ${repo}`
                );
            }
            await copyComponent(root, domain);
            installedNow.push({ domain, version: manifest?.version });
        }

        const now = new Date().toISOString();
        for (const { domain, version } of installedNow) {
            await cs.haCustomIntegrations.updateOne(
                { domain },
                {
                    $set: {
                        domain,
                        repo,
                        ref: release.ref,
                        version,
                        installedAt: now,
                    },
                },
                { upsert: true }
            );
        }

        log('homeassistant', `Community integration installed: ${repo}`, {
            data: JSON.stringify({
                domains: installedNow.map((d) => d.domain),
                ref: release.ref,
            }),
        });

        return {
            repo,
            ref: release.ref,
            version: installedNow[0].version,
            domains: installedNow.map((d) => d.domain),
            domain: installedNow[0].domain,
            restartRequired: true,
        };
    } finally {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
}

export interface RemoveResult {
    domain: string;
    removed: boolean;
    restartRequired: boolean;
}

/** Remove a community integration (does not touch core integrations). */
export async function removeCommunity(domain: string): Promise<RemoveResult> {
    if (!domain || !/^[A-Za-z0-9_.-]+$/.test(domain)) {
        throw new HttpError(400, 'Invalid integration domain');
    }
    await fs.rm(path.join(CUSTOM_COMPONENTS_DIR, domain), {
        recursive: true,
        force: true,
    });
    await cs.haCustomIntegrations.deleteOne({ domain });
    log('homeassistant', `Community integration removed: ${domain}`);
    return { domain, removed: true, restartRequired: true };
}

export interface RestartReport {
    restarted: boolean;
    waitedMs: number;
    handlers?: { ready: boolean; missing: string[] };
}

/**
 * Restart HA (process only) and wait until it is back. After a restart the
 * ephemeral trusted-networks session is re-provisioned, so the caller can
 * immediately use the config-flow API again.
 */
export async function restartHaAndWait(
    timeoutMs = 180000,
    waitDomains?: string[]
): Promise<RestartReport> {
    const started = Date.now();
    await haRestart();

    // Phase 1 (best effort): wait for HA to actually go down.
    const downDeadline = Date.now() + 30000;
    while (Date.now() < downDeadline) {
        try {
            await haPing();
        } catch {
            break;
        }
        await sleep(1000);
    }

    // Phase 2: wait for HA to come back up.
    let up = false;
    while (Date.now() - started < timeoutMs) {
        try {
            await haPing();
            up = true;
            break;
        } catch {
            await sleep(2000);
        }
    }
    if (!up) {
        throw new HttpError(
            504,
            'Home Assistant did not come back after restart'
        );
    }

    // Re-mint the ephemeral session, then (optionally) wait for the new
    // config-flow handlers to be registered.
    await ensureHaSession();

    let handlers: { ready: boolean; missing: string[] } | undefined;
    if (waitDomains?.length) {
        handlers = await waitForHandlers(waitDomains);
    }

    return { restarted: true, waitedMs: Date.now() - started, handlers };
}

/** Poll the config-flow handlers until the given domains are registered. */
export async function waitForHandlers(
    domains: string[],
    timeoutMs = 60000
): Promise<{ ready: boolean; missing: string[] }> {
    const deadline = Date.now() + timeoutMs;
    let handlers: string[] = [];
    while (Date.now() < deadline) {
        try {
            handlers = (await haListFlowHandlers()) ?? [];
            const missing = domains.filter((d) => !handlers.includes(d));
            if (!missing.length) return { ready: true, missing: [] };
        } catch {
            await ensureHaSession();
        }
        await sleep(2000);
    }
    return {
        ready: false,
        missing: domains.filter((d) => !handlers.includes(d)),
    };
}
