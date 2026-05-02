import fs from 'fs';
import { stt } from '../stt';
import { wavToPcm } from '../utils';
import WebSocket from 'ws';

describe('stt', () => {
    test('standard - allume la lumière du salon', async () => {
        let wavBuffer = fs.readFileSync(
            'src/echo/__tests__/rec-2026-03-09T20-38-20-462Z.wav'
        );
        let pcmBuffer = wavToPcm(wavBuffer);
        let text = await stt([pcmBuffer]);
        expect(text).toBe('Allume la lumière du salon.');
    });

    test('standard - éteint la lumière de la cuisine.', async () => {
        let wavBuffer = fs.readFileSync(
            'src/echo/__tests__/rec-2026-04-08T23-15-52-968Z.wav'
        );
        let pcmBuffer = wavToPcm(wavBuffer);
        let text = await stt([pcmBuffer]);
        expect(text).toBe('Charlie, éteins la lumière de la cuisine.');
    });

    test('Éteint la lumière de la cuisine.', async () => {
        const wavBuffer = fs.readFileSync(
            'src/echo/__tests__/rec-2026-03-09T20-38-34-447Z.wav'
        );
        const pcmBuffer = wavToPcm(wavBuffer);
        const text = await stt([pcmBuffer]);
        expect(text).toBe('Éteins la lumière de la cuisine.');
    });

    test('Quelle est la racine carrée de pi ?', async () => {
        const wavBuffer = fs.readFileSync('src/echo/__tests__/rec-2.wav');
        const pcmBuffer = wavToPcm(wavBuffer);
        const text = await stt([pcmBuffer]);
        expect(text).toBe('Quelle est la racine carrée de pi?');
    });

    test('charlie', async () => {
        const wavBuffer = fs.readFileSync('src/echo/__tests__/charlie-1.wav');
        const pcmBuffer = wavToPcm(wavBuffer);
        const text = await stt([pcmBuffer]);
        expect(text).toBe('Charlie.');
    });

    test('éteins la lumière de la salle à manger', async () => {
        const wavBuffer = fs.readFileSync('src/echo/__tests__/rec-5.wav');
        const pcmBuffer = wavToPcm(wavBuffer);
        const text = await stt([pcmBuffer]);
        expect(text).toBe('Éteins la lumière de la salle à manger.');
    });
});
