import 'dotenv/config';
import { initAll } from './init';
import { setupEchoListen } from './echo/listen';
import { setupMqttServer } from './messaging/receive';
import { setupRoutines } from './routines';
import { setupRotateProvidersIp } from './devices/rotateip.job';
import { settings } from './manager/services/settings';
import { setupRestApi } from './restapi-setup.';

(async () => {
    await initAll();

    await setupRestApi();

    if (settings.echos?.listen) {
        setupEchoListen();
    }

    if (settings.mqtt?.enabled) {
        setupMqttServer();
    }

    if (settings.routines?.enabled) {
        setupRoutines();
    }

    if (settings.devices?.providers?.rotateIp?.enabled) {
        setupRotateProvidersIp();
    }
})();
