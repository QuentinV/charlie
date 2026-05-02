import { Tools } from '../../../types';

interface WaitRequest {
    freeText: string;
    slots?: {
        timeUnit: 'hour' | 'min' | 'sec';
        text: string;
    };
}

export const tools: Tools = {
    wait: {
        exec: async (req: WaitRequest) => {
            if (!req.slots?.timeUnit || !req.slots?.text) return false;
            const unit = req.slots.timeUnit;
            const time =
                Number(req.slots.text) *
                (unit === 'hour' ? 3600 : unit === 'min' ? 60 : 1);

            return new Promise((res, rej) => {
                setTimeout(() => {
                    res(true);
                }, time * 1000);
            });
        },
    },
};

export default tools;
