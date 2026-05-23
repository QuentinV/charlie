import { Tools } from '../../types';
import greetings from './impl/greet';
import devices from './impl/devices';
import timer from './impl/timer';

export const getActions = async (): Promise<Tools> => ({
    ...greetings,
    ...devices,
    ...timer,
});
