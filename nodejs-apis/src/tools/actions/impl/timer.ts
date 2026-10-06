import { Tools } from '../../../types';

interface WaitRequest {
    freeText: string;
    slots?: {
        timeUnit: 'hour' | 'min' | 'sec';
        text?: string;
        number?: string;
    };
}

export const tools: Tools = {
    wait: {
        exec: async (req: WaitRequest) => {
            const amount = req.slots?.number ?? req.slots?.text;
            if (!req.slots?.timeUnit || !amount) return false;
            const unit = req.slots.timeUnit;
            const time =
                Number(amount) *
                (unit === 'hour' ? 3600 : unit === 'min' ? 60 : 1);
            if (Number.isNaN(time)) return false;

            return new Promise((res, rej) => {
                setTimeout(() => {
                    res(true);
                }, time * 1000);
            });
        },
    },
};

export default tools;
