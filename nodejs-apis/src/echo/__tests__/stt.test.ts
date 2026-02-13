import fs from 'fs';
import { stt } from '../stt';
import { wavToPcm } from '../utils';

describe('stt', () => {
    test('standard - allume la lumière du salon', async () => {
        let wavBuffer = fs.readFileSync('src/echo/__tests__/rec-1.wav');
        let pcmBuffer = wavToPcm(wavBuffer);
        let text = await stt([pcmBuffer], { trimEnd: true });
        expect(text).toBe('allume la lumière du salon');
    });

    xtest('quelle est la racine carrée de pi', async () => {
        const wavBuffer = fs.readFileSync('src/echo/__tests__/rec-2.wav');
        const pcmBuffer = wavToPcm(wavBuffer);
        const text = await stt([pcmBuffer]);
        expect(text).toBe('quelle est la racine carrée de pi');
    });

    xtest('ferme le volet du salon', async () => {
        const wavBuffer = fs.readFileSync('src/echo/__tests__/rec-3.wav');
        const pcmBuffer = wavToPcm(wavBuffer);
        const text = await stt([pcmBuffer]);
        expect(text).toBe('allume la lumière du salon');
    });

    test('ferme le volet du salon', async () => {
        const wavBuffer = fs.readFileSync('src/echo/__tests__/rec-4.wav');
        const pcmBuffer = wavToPcm(wavBuffer);
        const text = await stt([pcmBuffer], { trimEnd: true });
        expect(text).toBe('ferme les volets du salon');
    });

    test('charlie', async () => {
        const wavBuffer = fs.readFileSync('src/echo/__tests__/charlie-1.wav');
        const pcmBuffer = wavToPcm(wavBuffer);
        const text = await stt([pcmBuffer], { trimEnd: false });
        expect(text).toBe('charlie');
    });
});
