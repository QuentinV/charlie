import {
    deriveStateSchema,
    metricKeys,
    schemaSignature,
    stateSchemaChanged,
} from '../custom-schema';

describe('custom device schema derivation', () => {
    it('keeps only finite numeric metrics', () => {
        expect(
            deriveStateSchema({
                level: 21,
                properties: {
                    temperature: 19.4,
                    label: 'sunny',
                    supported_features: 3,
                },
            }).map((field) => field.key)
        ).toEqual(['level', 'temperature']);
    });

    it('emits each key once when level is also published in properties', () => {
        expect(
            deriveStateSchema({ level: 21, properties: { level: 21 } }).map(
                (field) => field.key
            )
        ).toEqual(['level']);
    });

    it('advertises nothing before a numeric state arrives', () => {
        expect(deriveStateSchema()).toEqual([]);
        expect(deriveStateSchema({ power: 'on' })).toEqual([]);
        expect(deriveStateSchema({ properties: { label: 'sunny' } })).toEqual(
            []
        );
    });

    it('labels level with its French name and humanises other keys', () => {
        const schema = deriveStateSchema({
            level: 21,
            properties: { outside_temperature: 19.4 },
        });
        expect(schema.map((field) => field.label)).toEqual([
            'Niveau',
            'Outside temperature',
        ]);
    });

    it('marks every metric readonly: the flow owns the state', () => {
        expect(
            deriveStateSchema({
                level: 21,
                properties: { humidity: 60 },
            }).every((field) => field.readonly === true)
        ).toBe(true);
    });
});

describe('custom device schema signature', () => {
    it('is stable when only the readings change', () => {
        expect(
            schemaSignature({ level: 21, properties: { temperature: 19.4 } })
        ).toBe(
            schemaSignature({ level: 25, properties: { temperature: 22.1 } })
        );
    });

    it('changes when a metric key appears or disappears', () => {
        expect(schemaSignature({ level: 21 })).not.toBe(
            schemaSignature({ level: 21, properties: { temperature: 19.4 } })
        );
        expect(schemaSignature({ properties: { temperature: 19.4 } })).not.toBe(
            schemaSignature({
                properties: { temperature: 19.4, humidity: 60 },
            })
        );
    });

    it('ignores bookkeeping keys and non-numeric values', () => {
        expect(
            schemaSignature({ properties: { state_class: 'measurement' } })
        ).toBe('');
        expect(schemaSignature({ properties: { label: 'sunny' } })).toBe('');
    });

    it('is order independent', () => {
        expect(
            schemaSignature({ properties: { temperature: 1, humidity: 2 } })
        ).toBe(
            schemaSignature({ properties: { humidity: 2, temperature: 1 } })
        );
    });
});

describe('cached schema comparison', () => {
    it('reports no change when the advertised keys match', () => {
        const cached = deriveStateSchema({
            level: 21,
            properties: { temperature: 19.4 },
        });
        expect(
            stateSchemaChanged(cached, {
                level: 25,
                properties: { temperature: 22.1 },
            })
        ).toBe(false);
    });

    it('reports a change when a metric key appears or disappears', () => {
        const cached = deriveStateSchema({ level: 21 });
        expect(
            stateSchemaChanged(cached, {
                level: 21,
                properties: { temperature: 19.4 },
            })
        ).toBe(true);
        expect(stateSchemaChanged(cached, { power: 'on' })).toBe(true);
    });

    it('reports no change when nothing is cached', () => {
        expect(stateSchemaChanged(undefined, { level: 21 })).toBe(false);
    });
});

describe('metric keys', () => {
    it('lists numeric keys in publish order without duplicates', () => {
        expect(
            metricKeys({ level: 21, properties: { level: 21, humidity: 60 } })
        ).toEqual(['level', 'humidity']);
    });
});
