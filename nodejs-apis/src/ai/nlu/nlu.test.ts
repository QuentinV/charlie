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
            freeText: 'la mus',
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

        expect(await findIntent('ouvre la maison')).toStrictEqual({
            name: 'turnOnDevice',
            freeText: 'la maison',
            slots: {
                predefinedRoom: 'house',
            },
        });

        expect(await findIntent('ouvre les volets de la maison')).toStrictEqual(
            {
                name: 'turnOnDevice',
                freeText: 'les volets de la maison',
                slots: {
                    deviceType: 'shutter',
                    plurial: 'plurial',
                    predefinedRoom: 'house',
                },
            }
        );
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
                number: '1',
                timeUnit: 'min',
            },
        });

        expect(await findIntent('attend une heure')).toStrictEqual({
            name: 'wait',
            freeText: 'une heure',
            slots: {
                number: '1',
                timeUnit: 'hour',
            },
        });
    });

    test('lead-ins, politeness and separators', async () => {
        expect(await findIntent('Charlie, allume la lumière')).toStrictEqual({
            name: 'turnOnDevice',
            freeText: 'la lumière',
            slots: { deviceType: 'light' },
        });
        expect(
            await findIntent('peux-tu allumer la lumière du salon')
        ).toStrictEqual({
            name: 'turnOnDevice',
            freeText: 'la lumière du salon',
            slots: { deviceType: 'light', room: 'salon' },
        });
        expect(
            await findIntent("arrête la musique s'il te plaît")
        ).toStrictEqual({
            name: 'pauseDevice',
            freeText: 'la musique',
            slots: { text: 'musique' },
        });
    });

    test('questions', async () => {
        expect(await findIntent('quelle heure est-il ?')).toStrictEqual({
            name: 'askTime',
            freeText: 'est il',
        });
        expect(await findIntent('quel jour on est ?')).toStrictEqual({
            name: 'askDate',
            freeText: 'on est',
        });
        expect(await findIntent('quel temps fait-il ?')).toStrictEqual({
            name: 'askWeather',
            freeText: 'fait il',
        });
        expect(await findIntent('comment ça va ?')).toStrictEqual({
            name: 'howAreYou',
        });
        expect(await findIntent('qui es-tu ?')).toStrictEqual({
            name: 'whoAreYou',
        });
    });

    test('device state query', async () => {
        expect(
            await findIntent('est-ce que la lumière du salon est allumée ?')
        ).toStrictEqual({
            name: 'deviceStateQuery',
            freeText: 'la lumière du salon est allumée',
            slots: { deviceType: 'light', state: 'state', room: 'salon' },
        });
        expect(
            await findIntent('est ce que les volets du salon sont fermés')
        ).toStrictEqual({
            name: 'deviceStateQuery',
            freeText: 'les volets du salon sont fermés',
            slots: {
                plurial: 'plurial',
                deviceType: 'shutter',
                state: 'state',
                room: 'salon',
            },
        });
    });

    test('brightness and volume', async () => {
        expect(await findIntent('mets la lumière à 50')).toStrictEqual({
            name: 'setBrightness',
            freeText: '50',
            slots: { number: '50' },
        });
        expect(
            await findIntent('augmente la luminosité du salon')
        ).toStrictEqual({
            name: 'brightnessUp',
            freeText: 'du salon',
            slots: { room: 'salon' },
        });
        expect(await findIntent('baisse le volume du salon')).toStrictEqual({
            name: 'volumeDown',
            freeText: 'du salon',
            slots: { room: 'salon' },
        });
        expect(await findIntent('mets le volume à 20')).toStrictEqual({
            name: 'setVolume',
            freeText: '20',
            slots: { number: '20' },
        });
    });

    test('small talk', async () => {
        expect(await findIntent('merci')).toStrictEqual({ name: 'thanks' });
        expect(await findIntent('merci beaucoup')).toStrictEqual({
            name: 'thanks',
        });
        expect(await findIntent('au revoir')).toStrictEqual({
            name: 'goodbye',
        });
        expect(await findIntent('oui')).toStrictEqual({ name: 'confirm' });
        expect(await findIntent(`d'accord`)).toStrictEqual({ name: 'confirm' });
        expect(await findIntent('non')).toStrictEqual({ name: 'deny' });
        expect(await findIntent(`non c'est bon`)).toStrictEqual({
            name: 'pauseDevice',
        });
    });
});
