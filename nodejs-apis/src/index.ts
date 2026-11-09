import 'dotenv/config';
import { initAll } from './init';
import { setupEchoListen } from './echo/listen';
import { setupMqttServer } from './messaging/receive';
import { setupAutomations } from './automations';
import { setupRotateProvidersIp } from './devices/rotateip.job';
import { settings } from './manager/services/settings';
import { setupRestApi } from './restapi-setup.';
import { setupChatServer } from './ai/chat-server';

(async () => {
    await initAll();

    const hserver = await setupRestApi();

    if (hserver) {
        setupChatServer(hserver);
    }

    if (settings.echos?.listen) {
        setupEchoListen();
    }

    if (settings.mqtt?.enabled) {
        setupMqttServer();
    }

    setupAutomations();

    if (settings.devices?.providers?.rotateIp?.enabled) {
        setupRotateProvidersIp();
    }
})();
