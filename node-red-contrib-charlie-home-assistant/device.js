const { conf, isReady, apiUrl, mqttHost } = require('./shared');
const mqtt = require('mqtt');

module.exports = function (RED) {
    function MyNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        let ready = false;
        let client = null;

        (async () => {
            if (
                !config.id ||
                !config.name ||
                !config.externalId ||
                !config.deviceType
            )
                return;

            await isReady();

            // register device
            await fetch(`${apiUrl()}/api/devices`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    _id: config.id,
                    name: config.name,
                    externalId: config.externalId,
                    provider: conf.provider.id,
                    type: config.deviceType,
                }),
            });

            client = mqtt.connect(mqttHost());

            client.on('connect', () => {
                client.subscribe(`device/${config._id}/state`);
            });

            client.on('message', (topic, payload) => {
                const res = JSON.parse(payload.toString());
                const oi =
                    res.power === 'on'
                        ? 0
                        : res.power === 'off' || config.deviceType === 'shutter'
                          ? 1
                          : 2;

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
                    mqttClient.publish(
                        `device/state`,
                        JSON.stringify({
                            id: config.id,
                            power: payload.state,
                            level: payload.level ?? 100,
                        }),
                        {
                            qos: 0,
                        }
                    );
                } catch (e) {
                    node.warn('Error cannot send state to home assistant.');
                }
            }
        });
    }

    RED.nodes.registerType('charlie-device', MyNode);
};
