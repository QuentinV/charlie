import { Tools } from '../../types';
import greetings from './impl/greet';
import devices from './impl/devices';
import timer from './impl/timer';
import questions from './impl/questions';
import profile from './impl/profile';
import memory from './impl/memory';

export const getActions = async (): Promise<Tools> => ({
    ...greetings,
    ...devices,
    ...timer,
    ...questions,
    ...profile,
    ...memory,
});
