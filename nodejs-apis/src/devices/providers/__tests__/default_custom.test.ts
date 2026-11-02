// `default_custom` imports the shared MQTT client for its publish path; mock it
// so the module loads without a broker.
jest.mock('../../../messaging/receive', () => ({
    mqttClient: { publish: jest.fn() },
}));

import default_custom, { deriveStateSchema } from '../default_custom';

/**
 * A Node-RED custom device declares no schema: its capability vocabulary is
 * whatever the flow publishes over MQTT. These tests pin the derivation the
 * history chart relies on to offer a metric picker.
 */
describe('default_custom provider', () => {
    const api = default_custom.api;

    it('charts every finite-number property, plus level', () => {
        const schema = deriveStateSchema({
            level: 42,
            properties: {
                temperature: 21.5,
                humidity: 60,
                battery: 87,
                condition: 'sunny',
                supported_features: 3,
                unit_of_measurement: '%',
            },
        });

        expect(schema.map((field) => field.key)).toEqual([
            'level',
            'temperature',
            'humidity',
            'battery',
        ]);
        expect(schema.find((field) => field.key === 'temperature')).toEqual({
            key: 'temperature',
            label: 'Temperature',
            type: 'number',
            readonly: true,
        });
    });

    it('emits a key once when level is also published in properties', () => {
        const schema = deriveStateSchema({
            level: 21,
            properties: { level: 21, temperature: 19.4 },
        });

        expect(schema.map((field) => field.key)).toEqual([
            'level',
            'temperature',
        ]);
    });

    it('advertises nothing before a numeric state arrives', () => {
        expect(deriveStateSchema(undefined)).toEqual([]);
        expect(deriveStateSchema({ power: 'on', properties: {} })).toEqual([]);
    });

    it('exposes the derived schema through getCapabilities', async () => {
        const capabilities = await api.getCapabilities!({
            device: {
                state: {
                    power: 'on',
                    level: 10,
                    properties: { wind_speed: 12 },
                },
            },
        } as any);

        expect(capabilities.state?.map((field) => field.key)).toEqual([
            'level',
            'wind_speed',
        ]);
        expect(capabilities.functions).toEqual([]);
    });
});
