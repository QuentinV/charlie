import { cs } from '../../core/db';

export default {
    'device/state': async (data: string) => {
        //console.log('receiving', data);
        const { externalId, power, level } = JSON.parse(data);
        if (!externalId) return;

        console.log('receive message', externalId, power, level);
        await cs.devices.updateOne(
            { externalId },
            { $set: { state: { power, level } } }
        );
    },
};
