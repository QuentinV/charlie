import { cs } from '../../core/db';
import {
    decodeEchoId,
    echoSettingsId,
    encodeEchoId,
    findEchoSettingsById,
    isMacId,
    normalizeIp,
    normalizeMac,
    registerVersions,
    saveEchoSettings,
} from '../identity';

const MAC = 'aa:bb:cc:dd:ee:ff';
const MAC_ID = 'aa-bb-cc-dd-ee-ff';
const IP = '192.168.1.42';
const IP_ID = '192-168-1-42';

/** Minimal in-memory stand-in for `cs.echoSettings`, enough for the helpers. */
function fakeCollection() {
    const docs: any[] = [];
    let nextId = 0;

    const matches = (doc: any, filter: any): boolean =>
        Object.entries(filter).every(([key, value]) => {
            if (value && typeof value === 'object' && '$in' in (value as any)) {
                return (value as any).$in.includes(doc[key]);
            }
            return doc[key] === value;
        });

    return {
        docs,
        findOne: async (filter: any) =>
            docs.find((d) => matches(d, filter)) ?? null,
        updateOne: async (filter: any, update: any, options?: any) => {
            const existing = docs.find((d) => matches(d, filter));
            if (existing) {
                Object.assign(existing, update.$set);
                return;
            }
            if (!options?.upsert) return;
            // The equality part of the filter seeds the inserted document.
            const seed: any = { _id: ++nextId };
            for (const [key, value] of Object.entries(filter)) {
                if (value && typeof value === 'object') continue;
                seed[key] = value;
            }
            docs.push({ ...seed, ...update.$set });
        },
    };
}

let settings: ReturnType<typeof fakeCollection>;

beforeEach(() => {
    settings = fakeCollection();
    (cs as any).echoSettings = settings;
});

describe('echo identity helpers', () => {
    test('normalizeIp removes the ipv6 mapped prefix', () => {
        expect(normalizeIp('::ffff:192.168.1.42')).toBe(IP);
        expect(normalizeIp('[::ffff:192.168.1.42]')).toBe(IP);
        expect(normalizeIp(' 192.168.1.42 ')).toBe(IP);
        expect(normalizeIp(undefined)).toBe('');
    });

    test('normalizeMac accepts dashes and normalises the case', () => {
        expect(normalizeMac('AA-BB-CC-DD-EE-FF')).toBe(MAC);
        expect(normalizeMac(' aa:bb:cc:dd:ee:ff ')).toBe(MAC);
    });

    test('anything that is not a mac is ignored', () => {
        expect(normalizeMac(IP)).toBeUndefined();
        expect(normalizeMac('aa:bb:cc:dd:ee')).toBeUndefined();
        expect(normalizeMac('')).toBeUndefined();
        expect(normalizeMac(undefined)).toBeUndefined();
    });

    test('a device id is dashes only, for both a mac and an ip', () => {
        expect(encodeEchoId('AA:BB:CC:DD:EE:FF')).toBe(MAC_ID);
        expect(encodeEchoId(IP)).toBe(IP_ID);
        expect(decodeEchoId(MAC_ID)).toEqual({ mac: MAC });
        expect(decodeEchoId(IP_ID)).toEqual({ ip: IP });
        expect(isMacId(MAC_ID)).toBe(true);
        expect(isMacId(IP_ID)).toBe(false);
    });

    test('a settings document is addressed by its mac when it has one', () => {
        expect(echoSettingsId({ mac: MAC, ip: IP })).toBe(MAC_ID);
        expect(echoSettingsId({ ip: IP })).toBe(IP_ID);
        expect(echoSettingsId(null)).toBe('');
    });
});

describe('registerVersions', () => {
    test('stores a device that reports a mac under that mac', async () => {
        const { id, mac } = await registerVersions(IP, {
            lib: '1.3.0',
            device: '1.0.0',
            type: 'echo-zero',
            mac: 'AA:BB:CC:DD:EE:FF',
        });

        expect(mac).toBe(MAC);
        expect(id).toBe(MAC_ID);
        expect(settings.docs).toHaveLength(1);
        expect(settings.docs[0]).toMatchObject({
            ip: IP,
            mac: MAC,
            deviceType: 'echo-zero',
        });
        expect(settings.docs[0].versions).toEqual({
            lib: '1.3.0',
            device: '1.0.0',
            type: 'echo-zero',
            mac: MAC,
        });
    });

    test('adopts the document saved against the previous ip', async () => {
        settings.docs.push({
            _id: 'legacy',
            ip: IP,
            wakeWordAccuracy: 0.85,
            screens: { refreshTime: 30, screens: [{ k: 0, texts: [] }] },
        });

        const { id } = await registerVersions(IP, { mac: MAC });

        expect(id).toBe(MAC_ID);
        expect(settings.docs).toHaveLength(1);
        expect(settings.docs[0]._id).toBe('legacy');
        expect(settings.docs[0].mac).toBe(MAC);
        // The settings of the device are not lost by the migration.
        expect(settings.docs[0].wakeWordAccuracy).toBe(0.85);
        expect(settings.docs[0].screens.refreshTime).toBe(30);
    });

    test('a new ip keeps the settings of the same device', async () => {
        settings.docs.push({
            _id: 'legacy',
            ip: IP,
            wakeWordAccuracy: 0.7,
        });

        await registerVersions(IP, { mac: MAC });
        await registerVersions('192.168.1.77', { mac: MAC });

        expect(settings.docs).toHaveLength(1);
        expect(settings.docs[0].ip).toBe('192.168.1.77');
        expect(settings.docs[0].wakeWordAccuracy).toBe(0.7);
    });

    test('matches a document keyed with the legacy ipv6 mapped prefix', async () => {
        settings.docs.push({ _id: 'legacy', ip: `::ffff:${IP}` });

        await registerVersions(`::ffff:${IP}`, { mac: MAC, type: 'echo-zero' });

        expect(settings.docs).toHaveLength(1);
        expect(settings.docs[0]).toMatchObject({ ip: IP, mac: MAC });
    });

    test('keeps the ip as identity when the firmware reports no mac', async () => {
        const { id, mac } = await registerVersions(IP, { lib: '1.2.0' });

        expect(mac).toBeUndefined();
        expect(id).toBe(IP_ID);
        expect(settings.docs).toHaveLength(1);
        expect(settings.docs[0].ip).toBe(IP);
        expect(settings.docs[0].versions).toEqual({ lib: '1.2.0' });
    });

    test('a legacy ip document is updated instead of duplicated', async () => {
        settings.docs.push({ _id: 'legacy', ip: IP, mac: MAC });

        await registerVersions(IP, { lib: '1.3.0' });
        await registerVersions(IP, { lib: '1.3.0' });

        expect(settings.docs).toHaveLength(1);
        expect(settings.docs[0]._id).toBe('legacy');
        expect(settings.docs[0].versions).toEqual({ lib: '1.3.0' });
    });
});

describe('settings of a device', () => {
    test('a save from the UI updates the document of the mac', async () => {
        await registerVersions(IP, { mac: MAC });
        const doc = await findEchoSettingsById(MAC_ID);

        await saveEchoSettings(MAC_ID, { serverIp: '192.168.1.2' });

        expect(settings.docs).toHaveLength(1);
        expect(settings.docs[0]._id).toBe(doc!._id);
        expect(settings.docs[0].serverIp).toBe('192.168.1.2');
    });

    test('the first save of an unknown device creates its document', async () => {
        await saveEchoSettings(IP_ID, { wakeWordAccuracy: 0.6 });

        expect(settings.docs).toHaveLength(1);
        expect(settings.docs[0]).toMatchObject({
            ip: IP,
            wakeWordAccuracy: 0.6,
        });
    });

    test('reading a device is the same before and after its first connect', async () => {
        settings.docs.push({ _id: 'legacy', ip: IP, serverIp: '10.0.0.1' });

        expect(await findEchoSettingsById(IP_ID)).toMatchObject({
            serverIp: '10.0.0.1',
        });

        await registerVersions(IP, { mac: MAC });

        // The document is now reached through the mac of the device.
        expect(await findEchoSettingsById(MAC_ID)).toMatchObject({
            serverIp: '10.0.0.1',
        });
    });
});