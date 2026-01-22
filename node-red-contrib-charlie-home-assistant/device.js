const { conf, isReady, apiUrl, mqttHost } = require('./shared');
const mqtt = require('mqtt');

module.exports = function (RED) {
    function MyNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        let ready = false;

        (async () => {
            if (
                !config._id ||
                !config.name ||
                !config.externalId ||
                !config.deviceType
            )
                return;

            await isReady();

            // register device
            await fetch(`${apiUrl()}/api/devices`, {
                method: 'POST',
                body: JSON.stringify({
                    _id: config._id,
                    name: config.name,
                    externalId: config.externalId,
                    provider: conf.provider.id,
                    type: config.deviceType,
                }),
            });

            const client = mqtt.connect(mqttHost());

            client.on('connect', () => {
                client.subscribe(`device/${config._id}/state`);
            });

            client.on('message', (topic, payload) => {
                const res = JSON.parse(payload);
                const oi = res.power === 'on' ? 0 : res.power === 'off' ? 1 : 2;

                const outputs = [null, null, null];
                outputs[oi] = {
                    topic: config._id,
                    payload: { state: res.power, level: res.level },
                };

                node.send(outputs);
            });

            ready = true;
        })();

        node.on('input', async function (msg, send) {
            if (!ready) return;

            const payload = msg.payload;

            if (payload.state) {
                try {
                    await fetch(`${apiUrl()}/api/devices/${config._id}/state`, {
                        method: 'PUT',
                        body: JSON.stringify({
                            power: payload.state,
                            level: payload.level ?? 100,
                        }),
                    });
                } catch (e) {
                    node.warn('Error cannot send state to home assistant.');
                }
            }
        });
    }

    RED.nodes.registerType('charlie-device', MyNode);
};
