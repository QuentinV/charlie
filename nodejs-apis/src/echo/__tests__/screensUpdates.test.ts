import { cs } from '../../core/db';
import { getDeviceState } from '../../devices';
import { logDeviceState } from '../../devices/history';
import { connectedEchos } from '../listen';
import { findEchoSettingsByIp } from '../identity';
import { updateDisplays } from '../service';
import {
    clearScreenUpdatesForIp,
    resetScreenDeviceCache,
    startScreenUpdatesForIp,
} from '../screensUpdates';

jest.mock('../../core/db', () => ({
    cs: { devices: { findOne: jest.fn() } },
}));
jest.mock('../../devices', () => ({ getDeviceState: jest.fn() }));
jest.mock('../../devices/history', () => ({ logDeviceState: jest.fn() }));
jest.mock('../../manager/services/activities', () => ({ log: jest.fn() }));
jest.mock('../listen', () => ({
    connectedEchos: {},
    getEchoMacByIp: jest.fn(() => null),
}));
jest.mock('../identity', () => ({ findEchoSettingsByIp: jest.fn() }));
jest.mock('../service', () => ({ updateDisplays: jest.fn() }));

const findOne = cs.devices.findOne as unknown as jest.Mock;
const getState = getDeviceState as unknown as jest.Mock;
const logState = logDeviceState as unknown as jest.Mock;
const update = updateDisplays as unknown as jest.Mock;
const findSettings = findEchoSettingsByIp as unknown as jest.Mock;

const IP = '192.168.1.42';

/** `refreshScreensForIp` is fire-and-forget: let its microtasks settle. */
async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20));
}

function screen(k: number, ...texts: string[]) {
    return { k, texts: texts.map((v) => ({ v, ts: 1 })) };
}

function serveDevice(state: any, name = 'Salon') {
    findOne.mockResolvedValue({ _id: 'dev-salon', name, state });
    getState.mockResolvedValue(state);
}

let now = 1_000_000;

beforeEach(() => {
    jest.clearAllMocks();
    resetScreenDeviceCache();
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    connectedEchos[IP] = {} as any;
});

afterEach(() => {
    clearScreenUpdatesForIp(IP);
    delete connectedEchos[IP];
    jest.restoreAllMocks();
});

describe('screen updates', () => {
    it('refreshes a device once for every screen and text using it', async () => {
        serveDevice({ power: 'on', level: 21 });
        findSettings.mockResolvedValue({
            screens: {
                refreshTime: 30,
                screens: [
                    screen(
                        0,
                        'A {{device:Salon:state.level}}',
                        'B {{device:salon:power}}'
                    ),
                    screen(1, '{{device:Salon:state.level}}°C'),
                ],
            },
        });

        await startScreenUpdatesForIp(IP);
        await flush();

        // One lookup + one state refresh for three placeholders on 2 screens.
        expect(findOne).toHaveBeenCalledTimes(1);
        expect(getState).toHaveBeenCalledTimes(1);
        expect(logState).toHaveBeenCalledTimes(1);

        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith(IP, [
            {
                k: 0,
                texts: [
                    { ts: 1, v: 'A 21', cx: undefined, cy: undefined, r: undefined },
                    { ts: 1, v: 'B on', cx: undefined, cy: undefined, r: undefined },
                ],
            },
            {
                k: 1,
                texts: [
                    { ts: 1, v: '21°C', cx: undefined, cy: undefined, r: undefined },
                ],
            },
        ]);
    });

    it('shares one refresh between echos updating in the same wave', async () => {
        const otherIp = '192.168.1.43';
        connectedEchos[otherIp] = {} as any;
        serveDevice({ level: 19.5 });
        findSettings.mockResolvedValue({
            screens: {
                refreshTime: 30,
                screens: [screen(0, '{{device:Salon:state.level}}')],
            },
        });

        await startScreenUpdatesForIp(IP);
        await startScreenUpdatesForIp(otherIp);
        await flush();

        expect(getState).toHaveBeenCalledTimes(1);
        expect(logState).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledTimes(2);
        expect(update.mock.calls[0][1][0].texts[0].v).toBe('19.5');
        expect(update.mock.calls[1][1][0].texts[0].v).toBe('19.5');

        clearScreenUpdatesForIp(otherIp);
        delete connectedEchos[otherIp];
    });

    it('refreshes again on the next cycle, once the wave is over', async () => {
        serveDevice({ level: 21 });
        findSettings.mockResolvedValue({
            screens: {
                refreshTime: 30,
                screens: [screen(0, '{{device:Salon:state.level}}')],
            },
        });

        await startScreenUpdatesForIp(IP);
        await flush();
        expect(getState).toHaveBeenCalledTimes(1);

        // Next 30 s tick: the entry is older than the wave TTL → one new read.
        now += 30_000;
        await startScreenUpdatesForIp(IP);
        await flush();
        expect(getState).toHaveBeenCalledTimes(2);
        expect(logState).toHaveBeenCalledTimes(2);
    });

    it('renders unknown devices and missing properties as placeholders', async () => {
        findOne.mockResolvedValue(null);
        findSettings.mockResolvedValue({
            screens: {
                refreshTime: 30,
                screens: [screen(0, '{{device:Inconnu:state.level}}')],
            },
        });

        await startScreenUpdatesForIp(IP);
        await flush();

        expect(getState).not.toHaveBeenCalled();
        expect(update.mock.calls[0][1][0].texts[0].v).toBe(
            '??Inconnu:not found??'
        );

        // A known device without that property is reported, not left blank.
        serveDevice({});
        resetScreenDeviceCache();
        findSettings.mockResolvedValue({
            screens: {
                refreshTime: 30,
                screens: [screen(0, '{{device:Salon:state.level}}')],
            },
        });

        await startScreenUpdatesForIp(IP);
        await flush();

        expect(update.mock.calls[1][1][0].texts[0].v).toBe(
            '??Salon:state.level??'
        );
    });

    it('never interprets a reading as a replacement pattern', async () => {
        serveDevice({ level: 0, properties: { condition: 'Averses $& 100%' } });
        findSettings.mockResolvedValue({
            screens: {
                refreshTime: 30,
                screens: [
                    screen(0, '{{device:Salon:state.properties.condition}}'),
                ],
            },
        });

        await startScreenUpdatesForIp(IP);
        await flush();

        expect(update.mock.calls[0][1][0].texts[0].v).toBe('Averses $& 100%');
    });
});
