const { conf, isReady, apiUrl, mqttHost } = require('./shared');
const mqtt = require('mqtt');
const http = require('http');

module.exports = function (RED) {
    function MyNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        let ready = false;
        let client = null;

        (async () => {
            if (!config.name || !config.externalId || !config.deviceType)
                return;

            await isReady();

            await new Promise((resolve, reject) => {
                const payload = JSON.stringify({
                    name: config.name,
                    externalId: config.externalId,
                    provider: conf.provider.id,
                    type: config.deviceType,
                });
                const req = http.request(
                    new URL(`${apiUrl()}/api/devices`),
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(payload),
                        },
                    },
                    (res) => {
                        let data = '';
                        res.on('data', (chunk) => (data += chunk));
                        res.on('end', () => {
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                resolve(data);
                            } else {
                                reject(
                                    new Error(`HTTP ${res.statusCode}: ${data}`)
                                );
                            }
                        });
                    }
                );

                req.on('error', reject);
                req.write(payload);
                req.end();
            });

            client = mqtt.connect(mqttHost());

            client.on('connect', () => {
                node.log(`MQTT connected for device ${config.externalId}`);
                client.subscribe(`device/${config.externalId}/state`);
            });

            client.on('error', (err) => {
                node.warn(
                    `MQTT error for device ${config.externalId}: ${err.message}`
                );
            });

            client.on('close', () => {
                node.log(
                    `MQTT connection closed for device ${config.externalId}`
                );
            });

            client.on('reconnect', () => {
                node.log(`MQTT reconnecting for device ${config.externalId}`);
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
                    topic: config.externalId,
                    payload: { state: res.power, level: res.level },
                };

                node.send(outputs);
            });

            ready = true;
        })();

        node.on('input', async function (msg, send) {
            if (!ready) return;

            const payload = msg.payload;

            if (
                payload.state === 'on' ||
                payload.state === 'off' ||
                payload.state === 'pause'
            ) {
                try {
                    client.publish(
                        `device/state`,
                        JSON.stringify({
                            externalId: config.externalId,
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

        node.on('close', () => client?.end(true));
    }

    RED.nodes.registerType('charlie-device', MyNode);
};
