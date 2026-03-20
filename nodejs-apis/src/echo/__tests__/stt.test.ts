import fs from 'fs';
import { stt } from '../stt';
import { wavToPcm } from '../utils';

describe('stt', () => {
    test('standard - allume la lumière du salon', async () => {
        let wavBuffer = fs.readFileSync(
            'src/echo/__tests__/rec-2026-03-09T20-38-20-462Z.wav'
        );
        let pcmBuffer = wavToPcm(wavBuffer);
        let text = await stt([pcmBuffer], { trimEnd: false, key: 'qwen' });
        expect(text).toBe('Allume la lumière du salon.');
    });

    xtest('full - allume la lumière du salon', async () => {
        let wavBuffer = fs.readFileSync('src/echo/__tests__/full-2.wav');
        let pcmBuffer = wavToPcm(wavBuffer);
        let text = await stt([pcmBuffer], { trimEnd: false, key: 'qwen' });
        expect(text).toBe('Charlie allume la lumière du salon.');
    });

    xtest('Éteint la lumière de la cuisine.', async () => {
        const wavBuffer = fs.readFileSync(
            'src/echo/__tests__/rec-2026-03-09T20-38-34-447Z.wav'
        );
        const pcmBuffer = wavToPcm(wavBuffer);
        const text = await stt([pcmBuffer], { trimEnd: false });
        expect(text).toBe('Éteint la lumière de la cuisine.');
    });

    xtest('Quelle est la racine carrée de pi ?', async () => {
        const wavBuffer = fs.readFileSync('src/echo/__tests__/rec-2.wav');
        const pcmBuffer = wavToPcm(wavBuffer);
        const text = await stt([pcmBuffer], { trimEnd: false });
        expect(text).toBe('Quelle est la racine carrée de pi?');
    });

    xtest('ferme le volet du salon', async () => {
        const wavBuffer = fs.readFileSync('src/echo/__tests__/rec-4.wav');
        const pcmBuffer = wavToPcm(wavBuffer);
        const text = await stt([pcmBuffer], { trimEnd: false });
        expect(text).toBe('Ferme les volets du salon.');
    });

    xtest('charlie', async () => {
        const wavBuffer = fs.readFileSync('src/echo/__tests__/charlie-1.wav');
        const pcmBuffer = wavToPcm(wavBuffer);
        const text = await stt([pcmBuffer], { trimEnd: false });
        expect(text).toBe('Charlie.');
    });

    xtest('éteins la lumière de la salle à manger', async () => {
        const wavBuffer = fs.readFileSync('src/echo/__tests__/rec-5.wav');
        const pcmBuffer = wavToPcm(wavBuffer);
        const text = await stt([pcmBuffer], { trimEnd: false });
        expect(text).toBe('Éteins la lumière de la salle à manger.');
    });
});
