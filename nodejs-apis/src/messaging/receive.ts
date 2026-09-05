import { getAllSubscribers } from './subscribers';
import Aedes from 'aedes';
import net from 'net';
import mqtt from 'mqtt';
import { log } from '../manager/services/activities';
import { MqttSubscriber } from '../types';

export let mqttClient = null;

// Resolved at MQTT connect (after all provider modules are evaluated).
let subscribers: Record<string, MqttSubscriber> = {};

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
        subscribers = getAllSubscribers();
        Object.keys(subscribers).forEach((s) => {
            mqttClient.subscribe(s);
            console.log(`[MQTT] subscribe to ${s}`);
        });
    });

    mqttClient.on('message', async (topic, message) => {
        //log('MQTT', `Received on ${topic}: ${message.toString()}`);
        if (subscribers[topic]) {
            try {
                subscribers[topic]?.(message.toString());
            } catch (e) {
                log('MQTT', 'Error receving message from ' + topic);
            }
        } else {
            console.log('[MQTT] Error topic not supported');
        }
    });
}
