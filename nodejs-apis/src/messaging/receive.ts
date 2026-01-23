import subscribers from './subscribers';
import Aedes from 'aedes';
import net from 'net';
import mqtt from 'mqtt';

export let mqttClient = null;

export function setupMqttServer() {
    const aedes = new Aedes();
    const server = net.createServer(aedes.handle);

    const mqttPort = 9304;
    server.listen(mqttPort, function () {
        console.log('[MQTT] broker started on port ' + mqttPort);
    });

    mqttClient = mqtt.connect(`mqtt://localhost:` + mqttPort);
    mqttClient.on('connect', () => {
        console.log('[MQTT] client connected to broker');
        Object.keys(subscribers).forEach((s) => {
            mqttClient.subscribe(s);
            console.log(`[MQTT] subscribe to ${s}`);
        });
    });

    mqttClient.on('message', async (topic, message) => {
        console.log(`[MQTT] Received on ${topic}: ${message.toString()}`);
        if (subscribers[topic]) {
            try {
                subscribers[topic]?.(message.toString());
            } catch (e) {
                console.log('[MQTT] Error receving message from ' + topic);
            }
        } else {
            console.log('[MQTT] Error topic not supported');
        }
    });
}
