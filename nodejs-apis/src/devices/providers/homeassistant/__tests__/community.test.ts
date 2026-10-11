import {
    CUSTOM_COMPONENTS_DIR,
    detectComponentDomains,
    normalizeRepo,
    parseCatalog,
    parseHacsManifest,
} from '../community.helpers';

describe('homeassistant community installer', () => {
    test('parseCatalog accepts a JSON array of owner/repo and drops junk', () => {
        const raw = JSON.stringify([
            'krahabb/meross_lan',
            'albertogeniola/meross-homeassistant',
            'not-a-repo',
            'owner/',
            42,
            null,
            'with spaces/bad repo',
        ]);
        expect(parseCatalog(raw)).toEqual([
            'krahabb/meross_lan',
            'albertogeniola/meross-homeassistant',
        ]);
    });

    test('parseCatalog returns [] for invalid or non-array JSON', () => {
        expect(parseCatalog('not json')).toEqual([]);
        expect(parseCatalog('{"a":1}')).toEqual([]);
        expect(parseCatalog('')).toEqual([]);
    });

    test('normalizeRepo handles owner/repo, https URL and .git URL', () => {
        expect(normalizeRepo('krahabb/meross_lan')).toBe(
            'krahabb/meross_lan'
        );
        expect(normalizeRepo('https://github.com/krahabb/meross_lan')).toBe(
            'krahabb/meross_lan'
        );
        expect(
            normalizeRepo('https://github.com/krahabb/meross_lan.git')
        ).toBe('krahabb/meross_lan');
        expect(
            normalizeRepo('https://github.com/krahabb/meross_lan/tree/master')
        ).toBe('krahabb/meross_lan');
        expect(normalizeRepo('  owner/repo  ')).toBe('owner/repo');
    });

    test('normalizeRepo rejects unusable input', () => {
        expect(normalizeRepo('')).toBeNull();
        expect(normalizeRepo('justaname')).toBeNull();
        expect(normalizeRepo('bad repo/x')).toBeNull();
        // runtime guard for non-string input
        expect(normalizeRepo(undefined as any)).toBeNull();
    });

    test('detectComponentDomains finds standard-layout domains', () => {
        const files = [
            'README.md',
            'hacs.json',
            'custom_components/meross_lan/manifest.json',
            'custom_components/meross_lan/__init__.py',
            'custom_components/meross_lan/sensor.py',
        ];
        expect(detectComponentDomains(files)).toEqual(['meross_lan']);
    });

    test('detectComponentDomains handles multiple domains and no-match', () => {
        expect(
            detectComponentDomains([
                'custom_components/a/manifest.json',
                'custom_components/b/manifest.json',
            ]).sort()
        ).toEqual(['a', 'b']);
        // content_in_root repos have no custom_components folder
        expect(detectComponentDomains(['manifest.json', 'sensor.py'])).toEqual(
            []
        );
    });

    test('parseHacsManifest reads content_in_root / zip_release', () => {
        expect(parseHacsManifest({ content_in_root: true })).toMatchObject({
            contentInRoot: true,
            zipRelease: false,
        });
        expect(
            parseHacsManifest({
                zip_release: true,
                filename: 'meross.zip',
                name: 'Meross LAN',
            })
        ).toMatchObject({
            contentInRoot: false,
            zipRelease: true,
            filename: 'meross.zip',
            name: 'Meross LAN',
        });
        expect(parseHacsManifest(null)).toMatchObject({
            contentInRoot: false,
            zipRelease: false,
        });
    });

    test('custom components dir lives under the HA config dir', () => {
        expect(CUSTOM_COMPONENTS_DIR.endsWith('custom_components')).toBe(true);
    });
});
