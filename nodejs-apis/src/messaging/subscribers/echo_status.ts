import { cs } from '../../core/db';

export default {
    'echo/status': async (data: string) => {
        const [mac, temp, hum, motion] = data.split(';');

        const provider = await cs.providers.findOne(
            { mac },
            { projection: { _id: 1 } }
        );
        if (!provider) return;

        const device = await cs.devices.findOne(
            { provider: provider._id },
            { projection: { _id: 1, name: 1 } }
        );
        if (!device) return;

        const state: any = {
            device: device._id,
            provider: provider._id,
            mac,
            deviceName: device.name,
            timestamp: Date.now(),
            temperature: parseFloat(temp),
            humidity: parseFloat(hum),
        };

        if (motion) {
            state.motionsensor = motion === '1';
        }

        await cs.states.insertOne(state);
    },
};
