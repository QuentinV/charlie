import { Tools } from '../../types';
import greetings from './impl/greet';
import devices from './impl/devices';

export const getActions = async (): Promise<Tools> => ({
    ...greetings,
    ...devices,
});
