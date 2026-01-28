import { Tools } from '../../types';
import greetings from './impl/greet';
import devices from './impl/devices';

export const actions = async (): Promise<Tools> => ({
    ...greetings,
    ...devices,
});
