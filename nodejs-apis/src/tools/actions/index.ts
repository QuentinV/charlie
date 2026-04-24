import { Tools } from '../../types';
import greetings from './impl/greet';
import devices from './impl/devices';
import weather from './impl/weather';
import timer from './impl/timer';

export const getActions = async (): Promise<Tools> => ({
    ...greetings,
    ...devices,
    ...weather,
    ...timer,
});
