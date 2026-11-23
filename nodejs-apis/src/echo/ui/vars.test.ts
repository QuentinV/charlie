import { loadDevice, resolveDeviceProperty } from '../screensUpdates';
import { parseDeviceVarPath, resolveVars } from './vars';

jest.mock('../screensUpdates', () => ({
    loadDevice: jest.fn(),
    resolveDeviceProperty: jest.fn(),
}));

const load = loadDevice as unknown as jest.Mock;
const resolve = resolveDeviceProperty as unknown as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('parseDeviceVarPath', () => {
    it('splits a device variable into name and path', () => {
        expect(parseDeviceVarPath('external.devices.Chambre.state')).toEqual({
            name: 'Chambre',
            path: 'state',
        });
    });

    it('keeps dots inside the property path', () => {
        expect(
            parseDeviceVarPath('external.devices.Salon.sensors.temperature')
        ).toEqual({ name: 'Salon', path: 'sensors.temperature' });
    });

    it('rejects anything outside the devices namespace', () => {
        expect(parseDeviceVarPath('core.sensors.temperature')).toBeNull();
        expect(parseDeviceVarPath('external.weather.outside')).toBeNull();
        expect(parseDeviceVarPath('external.devices.Chambre')).toBeNull();
    });
});

describe('resolveVars', () => {
    it('prints resolved device values as strings', async () => {
        load.mockResolvedValue({ device: {}, at: Date.now() });
        resolve.mockImplementation((_entry: any, path: string) =>
            path === 'state' ? 'on' : undefined
        );

        const result = await resolveVars(['external.devices.Chambre.state']);
        expect(result.values).toEqual({ 'external.devices.Chambre.state': 'on' });
        expect(result.missing).toEqual([]);
        expect(result.unsupported).toEqual([]);
    });

    it('reports unknown devices as missing without failing the batch', async () => {
        load.mockResolvedValue(null);
        resolve.mockReturnValue(undefined);

        const result = await resolveVars([
            'external.devices.Unknown.state',
            'core.sensors.temperature',
        ]);
        expect(result.values).toEqual({});
        expect(result.missing).toEqual(['external.devices.Unknown.state']);
        expect(result.unsupported).toEqual(['core.sensors.temperature']);
    });

    it('formats numbers and booleans as text', async () => {
        load.mockResolvedValue({ device: {}, at: Date.now() });
        resolve.mockImplementation((_entry: any, path: string) => {
            if (path === 'temperature') return 21.5;
            if (path === 'on') return true;
            return undefined;
        });

        const result = await resolveVars([
            'external.devices.Salon.temperature',
            'external.devices.Salon.on',
        ]);
        expect(result.values['external.devices.Salon.temperature']).toBe('21.5');
        expect(result.values['external.devices.Salon.on']).toBe('true');
    });

    it('deduplicates repeated paths', async () => {
        load.mockResolvedValue({ device: {}, at: Date.now() });
        resolve.mockReturnValue('on');

        await resolveVars([
            'external.devices.Chambre.state',
            'external.devices.Chambre.state',
        ]);
        expect(load).toHaveBeenCalledTimes(1);
    });
});
