import { changeDeviceState } from '../../devices';

export default {
    'device/state': async (data: string) => {
        const { id, power, level } = JSON.parse(data);
        if (!id) return;

        await changeDeviceState(id, {
            power,
            level,
        });
    },
};
