import { findIntent } from './nlu';

describe('findIntent', () => {
    test('greet', async () => {
        expect(await findIntent('salut')).toStrictEqual({
            name: 'greet',
        });

        expect(await findIntent('salút')).toStrictEqual({
            name: 'greet',
        });

        expect(await findIntent('bonjour')).toStrictEqual({
            name: 'greet',
        });

        expect(await findIntent('bonjôur')).toStrictEqual({
            name: 'greet',
        });

        expect(await findIntent('bonjourrr')).toStrictEqual({
            name: 'greet',
        });

        expect(await findIntent('Bonjour !')).toStrictEqual({
            name: 'greet',
            freeText: '!',
        });

        expect(await findIntent('coucou')).toStrictEqual({
            name: 'greet',
        });

        expect(await findIntent('coucouuu')).toStrictEqual({
            name: 'greet',
        });

        expect(await findIntent('hello')).toStrictEqual({
            name: 'greet',
        });

        expect(await findIntent('hey')).toStrictEqual({
            name: 'greet',
        });

        expect(await findIntent('Bonsoir')).toStrictEqual({
            name: 'greet',
        });

        expect(await findIntent('Bonjour Charlie')).toStrictEqual({
            name: 'greet',
            freeText: 'Charlie',
        });

        expect(await findIntent('salut ça va')).toStrictEqual({
            name: 'greet',
            freeText: 'ça va',
        });

        expect(await findIntent('salut comment ça va')).toStrictEqual({
            name: 'greet',
            freeText: 'comment ça va',
        });

        expect(await findIntent('salut Comment ça Va')).toStrictEqual({
            name: 'greet',
            freeText: 'Comment ça Va',
        });

        // Negative tests case
        expect(await findIntent('saaaaallutuututuutut')).toBeUndefined();
        expect(await findIntent('pouet')).toBeUndefined();
        expect(await findIntent('bro')).toBeUndefined();
        expect(await findIntent('heyho')).toBeUndefined();
    });

    test('pauseDevice ', async () => {
        expect(await findIntent('stop')).toStrictEqual({
            name: 'pauseDevice',
        });

        expect(await findIntent('stoppe')).toStrictEqual({
            name: 'pauseDevice',
        });

        expect(await findIntent('arrête')).toStrictEqual({
            name: 'pauseDevice',
        });

        expect(await findIntent('arrête tout')).toStrictEqual({
            name: 'pauseDevice',
        });

        expect(await findIntent('laisse tomber')).toStrictEqual({
            name: 'pauseDevice',
        });

        expect(await findIntent('oublie')).toStrictEqual({
            name: 'pauseDevice',
        });

        expect(await findIntent('oublie ça')).toStrictEqual({
            name: 'pauseDevice',
            freeText: 'ça',
            slots: { text: 'ca' },
        });

        expect(await findIntent(`non c'est bon`)).toStrictEqual({
            name: 'pauseDevice',
        });

        expect(await findIntent('ça suffit')).toStrictEqual({
            name: 'pauseDevice',
        });

        expect(await findIntent('arrête la musique')).toStrictEqual({
            name: 'pauseDevice',
            freeText: 'la musique',
            slots: { text: 'musique' },
        });

        expect(await findIntent('stop la musique')).toStrictEqual({
            name: 'pauseDevice',
            freeText: 'la musique',
            slots: { text: 'musique' },
        });

        expect(await findIntent('stoppe la musique')).toStrictEqual({
            name: 'pauseDevice',
            freeText: 'la musique',
            slots: { text: 'musique' },
        });

        expect(await findIntent('stop la mus')).toStrictEqual({
            name: 'pauseDevice',
            freeText: 'la mu\s',
            slots: { text: 'mus' },
        });
    });

    test('turnOnDevice', async () => {
        expect(await findIntent('allume la lumière du salon')).toStrictEqual({
            name: 'turnOnDevice',
            freeText: 'la lumière du salon',
            slots: {
                deviceType: 'light',
                room: 'salon',
            },
        });

        expect(await findIntent('allume les lumières')).toStrictEqual({
            name: 'turnOnDevice',
            freeText: 'les lumières',
            slots: {
                deviceType: 'light',
                plurial: 'plurial',
            },
        });

        expect(await findIntent('allume toutes les lumières')).toStrictEqual({
            name: 'turnOnDevice',
            freeText: 'toutes les lumières',
            slots: {
                deviceType: 'light',
                plurial: 'plurial',
            },
        });

        expect(await findIntent('allume la lumière du cabannon')).toStrictEqual(
            {
                name: 'turnOnDevice',
                freeText: 'la lumière du cabannon',
                slots: {
                    deviceType: 'light',
                    room: 'cabannon',
                },
            }
        );

        expect(
            await findIntent('allume la lumière de la salle à manger')
        ).toStrictEqual({
            name: 'turnOnDevice',
            freeText: 'la lumière de la salle à manger',
            slots: {
                deviceType: 'light',
                room: 'salle a manger',
            },
        });

        expect(await findIntent('ouvre le volet du salon')).toStrictEqual({
            name: 'turnOnDevice',
            freeText: 'le volet du salon',
            slots: {
                deviceType: 'shutter',
                room: 'salon',
            },
        });
    });

    test('turnOffDevice', async () => {
        expect(await findIntent('éteint la lumière du salon')).toStrictEqual({
            name: 'turnOffDevice',
            freeText: 'la lumière du salon',
            slots: {
                deviceType: 'light',
                room: 'salon',
            },
        });

        expect(await findIntent('éteins les lumières')).toStrictEqual({
            name: 'turnOffDevice',
            freeText: 'les lumières',
            slots: {
                deviceType: 'light',
                plurial: 'plurial',
            },
        });

        expect(await findIntent('coupe la lumière du cabannon')).toStrictEqual({
            name: 'turnOffDevice',
            freeText: 'la lumière du cabannon',
            slots: {
                deviceType: 'light',
                room: 'cabannon',
            },
        });

        expect(
            await findIntent('désactives la lumière de la salle à manger')
        ).toStrictEqual({
            name: 'turnOffDevice',
            freeText: 'la lumière de la salle à manger',
            slots: {
                deviceType: 'light',
                room: 'salle a manger',
            },
        });

        expect(await findIntent('ferme le volet du salon')).toStrictEqual({
            name: 'turnOffDevice',
            freeText: 'le volet du salon',
            slots: {
                deviceType: 'shutter',
                room: 'salon',
            },
        });
    });

    test('play music', async () => {
        expect(
            await findIntent('joue la musique par grand corps malade')
        ).toStrictEqual({
            name: 'playMusic',
            freeText: 'par grand corps malade',
            slots: {
                text: 'grand corps malade',
            },
        });
    });

    test('wait', async () => {
        expect(await findIntent('attend 1 minute')).toStrictEqual({
            name: 'wait',
            freeText: '1 minute',
            slots: {
                timeUnit: 'min',
                text: '1',
            },
        });
    });
});
