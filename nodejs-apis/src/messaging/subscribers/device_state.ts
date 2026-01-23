import { cs } from '../../core/db';

export default {
    'device/state': async (data: string) => {
        const { id, power, level } = JSON.parse(data);
        if (!id) return;

        console.log('receive message', id, power, level);
        await cs.devices.updateOne(
            { _id: id },
            { $set: { state: { power, level } } }
        );
    },
};
